import Ajv from 'ajv';
import ajvErrors from 'ajv-errors';
import type { Format, ValidateFunction } from 'ajv';
import type { CustomTagConfig } from './customCodeTags.js';

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

export interface SchemaRegistry {
  schemas: Map<string, CompiledTagSchema>;
}

export interface SchemaLoadOptions {
  configDir?: string;
  loadFile?: (schemaPath: string, configDir: string) => unknown;
  /**
   * ajv formats registered on the validator before any tag schema compiles.
   * Useful for the `format` keyword in user schemas — e.g. a case-insensitive
   * `pl-boolean` accepting the 20-ish truthy strings PrairieLearn coerces.
   */
  formats?: Record<string, SchemaFormat>;
}

const DRAFT_06_URIS = new Set([
  'http://json-schema.org/draft-06/schema',
  'http://json-schema.org/draft-06/schema#',
  'https://json-schema.org/draft-06/schema',
  'https://json-schema.org/draft-06/schema#',
]);
const CANONICAL_DRAFT_06_URI = 'http://json-schema.org/draft-06/schema#';

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
  ajv.addMetaSchema({
    $id: CANONICAL_DRAFT_06_URI,
    id: CANONICAL_DRAFT_06_URI,
    $schema: CANONICAL_DRAFT_06_URI,
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
  if (options.formats) {
    for (const [name, format] of Object.entries(options.formats)) {
      ajv.addFormat(name, format);
    }
  }

  for (const tag of customTags ?? []) {
    if (!tag.schema) continue;
    const tagName = tag.name.toLowerCase();
    try {
      const rawSchema = resolveSchema(tag, options);
      if (!isObject(rawSchema)) {
        throw new Error('schema must be a JSON object');
      }
      if (
        typeof rawSchema.$schema !== 'string' ||
        !DRAFT_06_URIS.has(rawSchema.$schema)
      ) {
        throw new Error(
          'schema must declare "$schema": "http://json-schema.org/draft-06/schema#"',
        );
      }
      const schema = cloneSchema(rawSchema);
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
