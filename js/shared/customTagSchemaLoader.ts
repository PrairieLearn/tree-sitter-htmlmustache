import Ajv2020 from 'ajv/dist/2020.js';
import ajvErrors from 'ajv-errors';
import type { ValidateFunction } from 'ajv';
import { htmlElementAttributes } from 'html-element-attributes';
import { ariaAttributes } from 'aria-attributes';
import type { CustomTagConfig } from './customCodeTags.js';

export interface ConfigLoadError {
  message: string;
  tagName?: string;
}

export interface CompiledTagSchema {
  tagName: string;
  schema: Record<string, unknown>;
  validate: ValidateFunction;
}

export interface SchemaRegistry {
  schemas: Map<string, CompiledTagSchema>;
}

export interface SchemaLoadOptions {
  configDir?: string;
  loadFile?: (schemaPath: string, configDir: string) => unknown;
}

const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

// HTML global attributes per WHATWG (via html-element-attributes['*']) plus
// ARIA's `role` and aria-* attributes (via aria-attributes). The packages
// track the spec so the list stays current without a hand-curated set here.
//
// The empty `{}` schema means "any value" — fine for `htmlGlobalAttributes:
// true`, where the goal is to *permit* these attributes, not to type-check
// them. Schema authors who want stricter typing on, say, `tabindex` can
// redeclare it explicitly; their declaration wins via spread order below.
const GLOBAL_ATTRIBUTE_PROPERTIES: Record<string, unknown> = Object.fromEntries(
  [...htmlElementAttributes['*'], ...ariaAttributes].map((name) => [name, {}]),
);

// `data-*` is open-ended (any suffix is valid) so it stays a pattern rather
// than an explicit enumeration.
const GLOBAL_ATTRIBUTE_PATTERNS: Record<string, unknown> = {
  '^data-': {},
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

function expandHtmlGlobalAttributes(node: unknown): void {
  if (!isObject(node)) return;

  if (node.htmlGlobalAttributes === true) {
    delete node.htmlGlobalAttributes;
    const properties = isObject(node.properties) ? node.properties : {};
    node.properties = { ...GLOBAL_ATTRIBUTE_PROPERTIES, ...properties };
    const patternProperties = isObject(node.patternProperties)
      ? node.patternProperties
      : {};
    node.patternProperties = {
      ...GLOBAL_ATTRIBUTE_PATTERNS,
      ...patternProperties,
    };
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) expandHtmlGlobalAttributes(item);
    } else {
      expandHtmlGlobalAttributes(value);
    }
  }
}

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    coerceTypes: true,
    useDefaults: false,
    strict: false,
  });
  ajvErrors(ajv);
  return ajv;
}

function resolveSchema(
  tag: CustomTagConfig,
  options: SchemaLoadOptions,
): unknown {
  if (typeof tag.schema !== 'string') return tag.schema;
  if (!options.configDir || !options.loadFile) {
    throw new Error(
      `Schema path for <${tag.name}> cannot be resolved in this environment`,
    );
  }
  return options.loadFile(tag.schema, options.configDir);
}

export function loadSchemaRegistry(
  customTags: CustomTagConfig[] | undefined,
  options: SchemaLoadOptions = {},
): { registry: SchemaRegistry; loadErrors: ConfigLoadError[] } {
  const registry: SchemaRegistry = { schemas: new Map() };
  const loadErrors: ConfigLoadError[] = [];
  const ajv = createAjv();

  for (const tag of customTags ?? []) {
    if (!tag.schema) continue;
    const tagName = tag.name.toLowerCase();
    try {
      const rawSchema = resolveSchema(tag, options);
      if (!isObject(rawSchema)) {
        throw new Error('schema must be a JSON object');
      }
      if (rawSchema.$schema !== DRAFT_2020_12) {
        throw new Error(`schema must declare "$schema": "${DRAFT_2020_12}"`);
      }
      const schema = cloneSchema(rawSchema);
      expandHtmlGlobalAttributes(schema);
      const validate = ajv.compile(schema);
      registry.schemas.set(tagName, { tagName, schema, validate });
    } catch (error) {
      loadErrors.push({
        tagName,
        message: `Failed to load schema for <${tag.name}>: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return { registry, loadErrors };
}
