import Ajv2020 from 'ajv/dist/2020.js';
import ajvErrors from 'ajv-errors';
import type { Format, KeywordDefinition, ValidateFunction } from 'ajv';
import { htmlElementAttributes } from 'html-element-attributes';
import { ariaAttributes } from 'aria-attributes';
import type { CustomTagConfig } from './customCodeTags.js';

export type SchemaFormat = Format;

/**
 * Consumer-defined ajv keyword. Same shape as ajv's `KeywordDefinition` minus
 * the `keyword` field, which the linter derives from the registration key.
 */
export type SchemaKeyword = Omit<KeywordDefinition, 'keyword'>;

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
  /**
   * Names of consumer-registered keywords. The diagnostic rewriter uses this
   * set to detect ajv errors from non-built-in keywords and skip its
   * HTML-vocabulary translation for them (passing `error.message` through, or
   * falling back to a generic phrase that mentions the keyword name).
   */
  customKeywords: Set<string>;
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
  /**
   * ajv keywords registered on the validator before any tag schema compiles.
   * Thin pass-through to `ajv.addKeyword` — the registration key becomes the
   * keyword name. Use when JSON Schema's built-in vocabulary can't express a
   * domain-specific rule (e.g. cross-child comparisons over the new `text`
   * projection).
   */
  keywords?: Record<string, SchemaKeyword>;
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
  const customKeywords = new Set<string>();
  const registry: SchemaRegistry = { schemas: new Map(), customKeywords };
  const loadErrors: ConfigLoadError[] = [];
  const ajv = createAjv();
  if (options.formats) {
    for (const [name, format] of Object.entries(options.formats)) {
      ajv.addFormat(name, format);
    }
  }
  if (options.keywords) {
    for (const [name, keyword] of Object.entries(options.keywords)) {
      ajv.addKeyword({ ...keyword, keyword: name } as KeywordDefinition);
      customKeywords.add(name);
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
