import Ajv from 'ajv';
import ajvErrors from 'ajv-errors';
import type { Format, ValidateFunction } from 'ajv';
import type {
  ChildTagConfig,
  CustomTagConfig,
  SchemaRef,
} from './customCodeTags.js';
import type { CustomTagDefaults } from './configSchema.js';

export type SchemaFormat = Format;

export interface ConfigLoadError {
  message: string;
  tagName?: string;
  ruleName?: 'customTagSchema' | 'pluginModule';
}

export interface CompiledTagSchema {
  tagName: string;
  schema: Record<string, unknown>;
  validate: ValidateFunction;
}

export interface ChildTagSchemaConfig {
  allowAdditionalChildren: boolean;
  tags: Map<string, CompiledChildTagConfig>;
}

export interface TagValidationOptions {
  allowBooleanAttributes: boolean;
}

export interface CompiledChildTagConfig {
  tagName: string;
  allowBooleanAttributes: boolean;
  schema?: CompiledTagSchema;
  children?: ChildTagSchemaConfig;
}

export interface SchemaRegistry {
  schemas: Map<string, CompiledTagSchema>;
  children: Map<string, ChildTagSchemaConfig>;
  topLevelTags: Set<string>;
  childParents: Map<string, Set<string>>;
  tagOptions: Map<string, TagValidationOptions>;
}

export interface SchemaLoadOptions {
  configDir?: string;
  customTagDefaults?: CustomTagDefaults;
  loadFile?: (schemaPath: string, configDir: string) => unknown;
  /**
   * ajv formats registered on the validator before any tag schema compiles.
   * Useful for the `format` keyword in user schemas — e.g. a case-insensitive
   * `pl-boolean` accepting the 20-ish truthy strings PrairieLearn coerces.
   */
  formats?: Record<string, SchemaFormat>;
}

interface CompileContext {
  ajv: Ajv;
  options: SchemaLoadOptions;
  registry: SchemaRegistry;
  loadErrors: ConfigLoadError[];
}

// draft-06 is the newest JSON Schema dialect we accept; anything at draft-06 or
// below is allowed. We don't validate user schemas against the real
// meta-schemas (ajv runs with `validateSchema: false`), so ajv compiles any
// declared `$schema` with its draft-07 keyword implementations regardless of
// the dialect URI — meaning no meta-schema needs to be registered.
const MAX_ACCEPTED_DRAFT = 6;

// Recognize a `$schema` declaration as an accepted JSON Schema dialect:
//   - numbered drafts (`.../draft-NN/schema#`, incl. hyper-schema) up to draft-06
//   - the legacy version-less identifiers (`.../schema#`, `.../hyper-schema#`)
//     that predate numbered drafts
// and reject anything newer (draft-07 and the date-based 2019-09 / 2020-12
// dialects, which ajv@8 compiles with semantics we don't intend to support here).
function isAcceptedSchemaDialect(rawUri: unknown): boolean {
  if (typeof rawUri !== 'string') return false;
  const uri = rawUri.trim().toLowerCase();
  if (!/^https?:\/\/json-schema\.org\//.test(uri)) return false;
  // Date-based dialects (e.g. /draft/2019-09/, /draft/2020-12/) are all newer
  // than draft-07.
  if (/\/draft\/\d{4}-\d\d\//.test(uri)) return false;
  const numbered = uri.match(/\/draft-0*(\d+)\//);
  if (numbered) return Number(numbered[1]) <= MAX_ACCEPTED_DRAFT;
  // No draft number present — a legacy version-less identifier; accept it.
  return true;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

function createAjv(): Ajv {
  const ajv = new Ajv({
    allErrors: true,
    coerceTypes: true,
    useDefaults: false,
    strict: false,
    validateSchema: false,
  });
  ajvErrors(ajv);
  return ajv;
}

function resolveAllowBooleanAttributes(
  value: boolean | undefined,
  defaults: CustomTagDefaults | undefined,
): boolean {
  return value ?? defaults?.allowBooleanAttributes ?? true;
}

function resolveSchemaRef(
  schema: SchemaRef | undefined,
  tagName: string,
  options: SchemaLoadOptions,
): unknown {
  if (typeof schema !== 'string') return schema;
  if (!options.configDir || !options.loadFile) {
    throw new Error(
      `Schema path for <${tagName}> cannot be resolved in this environment`,
    );
  }
  return options.loadFile(schema, options.configDir);
}

function compileSchema(
  ajv: Ajv,
  schemaRef: SchemaRef | undefined,
  tagName: string,
  options: SchemaLoadOptions,
): CompiledTagSchema {
  const rawSchema = resolveSchemaRef(schemaRef, tagName, options);
  if (!isObject(rawSchema)) {
    throw new Error('schema must be a JSON object');
  }
  if (!isAcceptedSchemaDialect(rawSchema.$schema)) {
    throw new Error(
      'schema must declare a "$schema" of draft-06 or lower (e.g. "http://json-schema.org/draft-06/schema#")',
    );
  }
  const schema = cloneSchema(rawSchema);
  const validate = ajv.compile(schema);
  return { tagName: tagName.toLowerCase(), schema, validate };
}

function addChildParent(
  registry: SchemaRegistry,
  childTagName: string,
  parentTagName: string,
): void {
  const parents = registry.childParents.get(childTagName) ?? new Set();
  parents.add(parentTagName);
  registry.childParents.set(childTagName, parents);
}

function compileChildTag(
  child: ChildTagConfig,
  parentTagName: string,
  context: CompileContext,
): CompiledChildTagConfig {
  const { ajv, options, registry, loadErrors } = context;
  const childTagName = child.name.toLowerCase();
  addChildParent(registry, childTagName, parentTagName);
  const compiled: CompiledChildTagConfig = {
    tagName: childTagName,
    allowBooleanAttributes: resolveAllowBooleanAttributes(
      child.allowBooleanAttributes,
      options.customTagDefaults,
    ),
  };
  if (child.schema) {
    try {
      compiled.schema = compileSchema(ajv, child.schema, child.name, options);
    } catch (error) {
      loadErrors.push({
        tagName: childTagName,
        message: `Failed to load schema for <${child.name}> inside <${parentTagName}>: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  if (child.children) {
    compiled.children = compileChildrenConfig(
      childTagName,
      child.children,
      child.allowAdditionalChildren ?? false,
      context,
      compiled,
    );
  }
  return compiled;
}

function compileChildrenConfig(
  parentTagName: string,
  children: ChildTagConfig[],
  allowAdditionalChildren: boolean,
  context: CompileContext,
  selfChild?: CompiledChildTagConfig,
): ChildTagSchemaConfig {
  const { registry } = context;
  const childConfig: ChildTagSchemaConfig = {
    allowAdditionalChildren,
    tags: new Map(),
  };
  for (const child of children) {
    const childTagName = child.name.toLowerCase();
    const compiled =
      childTagName === parentTagName && selfChild
        ? selfChild
        : compileChildTag(child, parentTagName, context);
    childConfig.tags.set(compiled.tagName, compiled);
    if (compiled === selfChild) {
      addChildParent(registry, childTagName, parentTagName);
    }
  }
  return childConfig;
}

export function loadSchemaRegistry(
  customTags: CustomTagConfig[] | undefined,
  options: SchemaLoadOptions = {},
): { registry: SchemaRegistry; loadErrors: ConfigLoadError[] } {
  const registry: SchemaRegistry = {
    schemas: new Map(),
    children: new Map(),
    topLevelTags: new Set(),
    childParents: new Map(),
    tagOptions: new Map(),
  };
  const loadErrors: ConfigLoadError[] = [];
  const ajv = createAjv();
  const context: CompileContext = { ajv, options, registry, loadErrors };
  if (options.formats) {
    for (const [name, format] of Object.entries(options.formats)) {
      ajv.addFormat(name, format);
    }
  }

  for (const tag of customTags ?? []) {
    const tagName = tag.name.toLowerCase();
    registry.topLevelTags.add(tagName);
    registry.tagOptions.set(tagName, {
      allowBooleanAttributes: resolveAllowBooleanAttributes(
        tag.allowBooleanAttributes,
        options.customTagDefaults,
      ),
    });
    if (tag.schema) {
      try {
        registry.schemas.set(
          tagName,
          compileSchema(ajv, tag.schema, tag.name, options),
        );
      } catch (error) {
        loadErrors.push({
          tagName,
          message: `Failed to load schema for <${tag.name}>: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    if (tag.children) {
      registry.children.set(
        tagName,
        compileChildrenConfig(
          tagName,
          tag.children,
          tag.allowAdditionalChildren ?? false,
          context,
        ),
      );
    }
  }

  return { registry, loadErrors };
}
