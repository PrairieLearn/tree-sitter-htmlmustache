/**
 * Pure, browser-safe configuration schema: types, JSONC parsing, validation.
 *
 * No Node built-ins. File-system config discovery lives in
 * `js/shared/configFile.ts` and imports from this module.
 */

import { z } from 'zod';

import type {
  ChildTagConfig,
  CustomCodeTagConfig,
  SchemaRef,
} from './customCodeTags.js';
import { RULES } from './ruleMetadata.js';
import { isSyntacticRuleId } from './tagValidators.js';

const CSS_DISPLAY_VALUES = [
  'block',
  'inline',
  'inline-block',
  'table-row',
  'table-cell',
  'table',
  'table-row-group',
  'table-header-group',
  'table-footer-group',
  'table-column',
  'table-column-group',
  'table-caption',
  'list-item',
  'ruby',
  'ruby-base',
  'ruby-text',
  'none',
] as const;

const INDENT_MODES = ['never', 'always', 'attribute'] as const;

export const ruleSeveritySchema = z.enum(['error', 'warning', 'off']);
export type RuleSeverity = z.infer<typeof ruleSeveritySchema>;

export interface ElementContentTooLongOptions {
  elements: Array<{ tag: string; maxBytes: number }>;
}

export type RuleEntry = RuleSeverity | { severity: RuleSeverity };
export type RuleEntryWithOptions<TOptions> =
  | RuleSeverity
  | ({ severity: RuleSeverity } & Partial<TOptions>);

export interface RulesConfig {
  [ruleName: string]: RuleEntry | RuleEntryWithOptions<unknown> | undefined;
  nestedDuplicateSections?: RuleEntry;
  unquotedMustacheAttributes?: RuleEntry;
  consecutiveDuplicateSections?: RuleEntry;
  selfClosingNonVoidTags?: RuleEntry;
  duplicateAttributes?: RuleEntry;
  unescapedEntities?: RuleEntry;
  preferMustacheComments?: RuleEntry;
  unrecognizedHtmlTags?: RuleEntry;
  elementContentTooLong?: RuleEntryWithOptions<ElementContentTooLongOptions>;
  customTagSchema?: RuleEntry;
  customTagDeprecations?: RuleEntry;
  pluginModule?: RuleEntry;
}

export const ruleEntrySchema = z.union([
  ruleSeveritySchema,
  z.object({ severity: ruleSeveritySchema }).strict(),
]);

const elementContentTooLongOptionsSchema = z.object({
  elements: z.array(
    z
      .object({
        tag: z.string().min(1),
        maxBytes: z.number().min(0),
      })
      .strict(),
  ),
});

export const elementContentTooLongRuleEntrySchema = z.union([
  ruleSeveritySchema,
  z
    .object({
      severity: ruleSeveritySchema,
      elements: elementContentTooLongOptionsSchema.shape.elements.optional(),
    })
    .strict(),
]);

const ruleEntrySchemas = Object.fromEntries(
  RULES.map((rule) => [
    rule.name,
    rule.name === 'elementContentTooLong'
      ? elementContentTooLongRuleEntrySchema
      : ruleEntrySchema,
  ]),
);

export const rulesConfigSchema = z
  .object(ruleEntrySchemas)
  .partial()
  .catchall(ruleEntrySchema);

export interface CustomRule {
  id: string;
  selector: string;
  message: string;
  severity?: RuleSeverity;
  /**
   * Optional glob patterns (relative to the config file) restricting which
   * files this rule applies to. Applied as an additional filter on top of the
   * top-level `include`/`exclude` - a rule only fires for files that both
   * the top-level settings include AND the per-rule settings include.
   */
  include?: string[];
  exclude?: string[];
}

export interface NoBreakDelimiter {
  start: string;
  end: string;
}

export interface HtmlMustacheConfig {
  printWidth?: number;
  indentSize?: number;
  mustacheSpaces?: boolean;
  noBreakDelimiters?: NoBreakDelimiter[];
  customTagDefaults?: CustomTagDefaults;
  customTags?: CustomCodeTagConfig[];
  include?: string[];
  exclude?: string[];
  rules?: RulesConfig;
  customRules?: CustomRule[];
  /**
   * Path (relative to the config file) to an ESM/CJS module that supplies
   * htmlmustache plugin extensions. Supported exports are `formats` for AJV
   * schema formats and `validators` for synchronous custom-tag validators.
   */
  pluginModule?: string;
}

export interface CustomTagDefaults {
  allowBooleanAttributes?: boolean;
}

const nonEmptyStringSchema = z.string().min(1);
const nonEmptyStringArraySchema = z.array(nonEmptyStringSchema);
const schemaRefSchema: z.ZodType<SchemaRef> = z.union([
  nonEmptyStringSchema,
  z.object({}).catchall(z.unknown()),
]);

const customTagDefaultsSchema = z
  .object({
    allowBooleanAttributes: z.boolean().optional(),
  })
  .strict();

const childTagSchema: z.ZodType<ChildTagConfig> = z.lazy(() =>
  z
    .object({
      name: nonEmptyStringSchema,
      schema: schemaRefSchema.optional(),
      children: z.array(childTagSchema).optional(),
      allowAdditionalChildren: z.boolean().optional(),
      allowBooleanAttributes: z.boolean().optional(),
    })
    .strict(),
);

const customTagSchema: z.ZodType<CustomCodeTagConfig> = z
  .object({
    name: nonEmptyStringSchema,
    display: z.enum(CSS_DISPLAY_VALUES).optional(),
    languageAttribute: z.string().optional(),
    languageMap: z.record(z.string(), z.string()).optional(),
    languageDefault: z.string().optional(),
    indent: z.enum(INDENT_MODES).optional(),
    indentAttribute: z.string().optional(),
    schema: schemaRefSchema.optional(),
    children: z.array(childTagSchema).optional(),
    allowAdditionalChildren: z.boolean().optional(),
    allowBooleanAttributes: z.boolean().optional(),
  })
  .strict();

const noBreakDelimiterSchema = z
  .object({
    start: nonEmptyStringSchema,
    end: nonEmptyStringSchema,
  })
  .strict();

const customRuleSchema = z
  .object({
    id: nonEmptyStringSchema,
    selector: nonEmptyStringSchema,
    message: nonEmptyStringSchema,
    severity: ruleSeveritySchema.optional(),
    include: nonEmptyStringArraySchema.optional(),
    exclude: nonEmptyStringArraySchema.optional(),
  })
  .strict();

export const htmlMustacheConfigSchema = z
  .object({
    $schema: z.string().optional(),
    printWidth: z.number().positive().optional(),
    indentSize: z.number().positive().optional(),
    mustacheSpaces: z.boolean().optional(),
    noBreakDelimiters: z.array(noBreakDelimiterSchema).optional(),
    customTagDefaults: customTagDefaultsSchema.optional(),
    customTags: z.array(customTagSchema).optional(),
    include: nonEmptyStringArraySchema.optional(),
    exclude: nonEmptyStringArraySchema.optional(),
    rules: rulesConfigSchema.optional(),
    customRules: z.array(customRuleSchema).optional(),
    pluginModule: nonEmptyStringSchema.optional(),
  })
  .strict();

/**
 * Strip // line comments, block comments, and trailing commas from JSONC text,
 * then JSON.parse(). Preserves comments inside strings.
 */
export function parseJsonc(text: string): unknown {
  let result = '';
  let i = 0;
  while (i < text.length) {
    // String literal - copy verbatim
    if (text[i] === '"') {
      result += '"';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') {
          result += text[i] + (text[i + 1] ?? '');
          i += 2;
        } else {
          result += text[i];
          i++;
        }
      }
      if (i < text.length) {
        result += '"';
        i++;
      }
      continue;
    }
    // Line comment
    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; // skip */
      continue;
    }
    result += text[i];
    i++;
  }

  // Remove trailing commas before } or ]
  result = result.replace(/,\s*([}\]])/g, '$1');

  return JSON.parse(result);
}

function parseArrayItems<T>(
  value: unknown,
  itemSchema: z.ZodType<T>,
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: T[] = [];
  for (const entry of value) {
    const parsed = itemSchema.safeParse(entry);
    if (parsed.success) items.push(parsed.data);
  }
  return items.length > 0 ? items : undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
  return parseArrayItems(value, nonEmptyStringSchema);
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  const parsed = z.record(z.string(), z.string()).safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parseCustomTagDefaults(
  value: unknown,
): CustomTagDefaults | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const defaults: CustomTagDefaults = {};

  const allowBooleanAttributes = z
    .boolean()
    .safeParse(raw.allowBooleanAttributes);
  if (allowBooleanAttributes.success) {
    defaults.allowBooleanAttributes = allowBooleanAttributes.data;
  }

  return Object.keys(defaults).length > 0 ? defaults : undefined;
}

function parseChildTags(value: unknown): ChildTagConfig[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags: ChildTagConfig[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const name = nonEmptyStringSchema.safeParse(e.name);
    if (!name.success) continue;
    const tag: ChildTagConfig = { name: name.data };

    const schema = schemaRefSchema.safeParse(e.schema);
    if (schema.success) tag.schema = schema.data;

    const children = parseChildTags(e.children);
    if (children) tag.children = children;

    const allowAdditionalChildren = z
      .boolean()
      .safeParse(e.allowAdditionalChildren);
    if (allowAdditionalChildren.success) {
      tag.allowAdditionalChildren = allowAdditionalChildren.data;
    }

    const allowBooleanAttributes = z
      .boolean()
      .safeParse(e.allowBooleanAttributes);
    if (allowBooleanAttributes.success) {
      tag.allowBooleanAttributes = allowBooleanAttributes.data;
    }

    tags.push(tag);
  }
  return tags.length > 0 ? tags : undefined;
}

function parseCustomTags(value: unknown): CustomCodeTagConfig[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags: CustomCodeTagConfig[] = [];
  for (const entry of value) {
    const strictParsed = customTagSchema.safeParse(entry);
    if (strictParsed.success) {
      tags.push(strictParsed.data);
      continue;
    }

    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const name = nonEmptyStringSchema.safeParse(e.name);
    if (!name.success) continue;
    const tag: CustomCodeTagConfig = { name: name.data };

    const display = z.enum(CSS_DISPLAY_VALUES).safeParse(e.display);
    if (display.success) tag.display = display.data;

    const languageAttribute = z.string().safeParse(e.languageAttribute);
    if (languageAttribute.success) {
      tag.languageAttribute = languageAttribute.data;
    }

    const languageMap = parseStringRecord(e.languageMap);
    if (languageMap) tag.languageMap = languageMap;

    const languageDefault = z.string().safeParse(e.languageDefault);
    if (languageDefault.success) tag.languageDefault = languageDefault.data;

    const indent = z.enum(INDENT_MODES).safeParse(e.indent);
    if (indent.success) tag.indent = indent.data;

    const indentAttribute = z.string().safeParse(e.indentAttribute);
    if (indentAttribute.success) tag.indentAttribute = indentAttribute.data;

    const schema = schemaRefSchema.safeParse(e.schema);
    if (schema.success) tag.schema = schema.data;

    const children = parseChildTags(e.children);
    if (children) tag.children = children;

    const allowAdditionalChildren = z
      .boolean()
      .safeParse(e.allowAdditionalChildren);
    if (allowAdditionalChildren.success) {
      tag.allowAdditionalChildren = allowAdditionalChildren.data;
    }

    const allowBooleanAttributes = z
      .boolean()
      .safeParse(e.allowBooleanAttributes);
    if (allowBooleanAttributes.success) {
      tag.allowBooleanAttributes = allowBooleanAttributes.data;
    }

    tags.push(tag);
  }
  return tags.length > 0 ? tags : undefined;
}

function parseRuleEntry(
  key: string,
  value: unknown,
): RuleEntry | RuleEntryWithOptions<unknown> | null {
  const schema =
    key === 'elementContentTooLong'
      ? elementContentTooLongRuleEntrySchema
      : ruleEntrySchema;
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseElementContentTooLongOptions(
  value: unknown,
): ElementContentTooLongOptions | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const elements = parseArrayItems(
    raw.elements,
    elementContentTooLongOptionsSchema.shape.elements.element,
  );
  return elements ? { elements } : undefined;
}

function parseRulesLenient(value: unknown): RulesConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const rules: RulesConfig = {};
  let hasRules = false;
  for (const [key, entry] of Object.entries(value)) {
    if (!isSyntacticRuleId(key)) continue;
    if (key === 'elementContentTooLong') {
      if (typeof entry === 'string') {
        const parsed = ruleSeveritySchema.safeParse(entry);
        if (parsed.success) {
          rules.elementContentTooLong = parsed.data;
          hasRules = true;
        }
        continue;
      }
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const raw = entry as Record<string, unknown>;
        const severity = ruleSeveritySchema.safeParse(raw.severity);
        if (!severity.success) continue;
        const options = parseElementContentTooLongOptions(raw);
        rules.elementContentTooLong = options
          ? { severity: severity.data, ...options }
          : { severity: severity.data };
        hasRules = true;
      }
      continue;
    }
    const parsed = parseRuleEntry(key, entry);
    if (parsed === null) continue;
    (rules as Record<string, unknown>)[key] = parsed;
    hasRules = true;
  }
  return hasRules ? rules : undefined;
}

function parseCustomRules(value: unknown): CustomRule[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rules: CustomRule[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const id = nonEmptyStringSchema.safeParse(e.id);
    const selector = nonEmptyStringSchema.safeParse(e.selector);
    const message = nonEmptyStringSchema.safeParse(e.message);
    if (!id.success || !selector.success || !message.success) continue;
    const rule: CustomRule = {
      id: id.data,
      selector: selector.data,
      message: message.data,
    };
    const severity = ruleSeveritySchema.safeParse(e.severity);
    if (severity.success) rule.severity = severity.data;
    const include = parseStringArray(e.include);
    if (include) rule.include = include;
    const exclude = parseStringArray(e.exclude);
    if (exclude) rule.exclude = exclude;
    rules.push(rule);
  }
  return rules.length > 0 ? rules : undefined;
}

/**
 * Validate a raw parsed config object and return a typed HtmlMustacheConfig.
 * Unknown keys and invalid values are ignored for runtime compatibility.
 */
export function validateConfig(raw: unknown): HtmlMustacheConfig {
  const strictParsed = htmlMustacheConfigSchema.safeParse(raw);
  if (strictParsed.success) {
    const strictConfig: HtmlMustacheConfig = { ...strictParsed.data };
    delete (strictConfig as Record<string, unknown>).$schema;
    return strictConfig;
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const config: HtmlMustacheConfig = {};

  const printWidth = z.number().positive().safeParse(obj.printWidth);
  if (printWidth.success) config.printWidth = printWidth.data;

  const indentSize = z.number().positive().safeParse(obj.indentSize);
  if (indentSize.success) config.indentSize = indentSize.data;

  const mustacheSpaces = z.boolean().safeParse(obj.mustacheSpaces);
  if (mustacheSpaces.success) config.mustacheSpaces = mustacheSpaces.data;

  const noBreakDelimiters = parseArrayItems(
    obj.noBreakDelimiters,
    noBreakDelimiterSchema,
  );
  if (noBreakDelimiters) config.noBreakDelimiters = noBreakDelimiters;

  const customTagDefaults = parseCustomTagDefaults(obj.customTagDefaults);
  if (customTagDefaults) config.customTagDefaults = customTagDefaults;

  const include = parseStringArray(obj.include);
  if (include) config.include = include;

  const exclude = parseStringArray(obj.exclude);
  if (exclude) config.exclude = exclude;

  const parsedCustomTags = parseCustomTags(obj.customTags);
  if (parsedCustomTags) config.customTags = parsedCustomTags;

  const rules = parseRulesLenient(obj.rules);
  if (rules) config.rules = rules;

  const pluginModule = nonEmptyStringSchema.safeParse(obj.pluginModule);
  if (pluginModule.success) config.pluginModule = pluginModule.data;

  const customRules = parseCustomRules(obj.customRules);
  if (customRules) config.customRules = customRules;

  return config;
}
