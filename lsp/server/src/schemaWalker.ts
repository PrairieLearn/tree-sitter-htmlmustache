/**
 * Walks JSON Schema documents to extract completion candidates.
 *
 * Handles `allOf` / `anyOf` / `oneOf` / `if`+`then`+`else` by taking the union
 * of all branches — completion is permissive, the linter still enforces real
 * validity. No format-specific knowledge: format values come from standard
 * keywords (`enum`, `const`, `examples`, `default`, `type: "boolean"`).
 */

export type JSONSchema = Record<string, unknown>;

export interface AttributeInfo {
  name: string;
  /**
   * True if the property name appears in the attributes schema's top-level
   * `required` array. Conditional `required` from `if`/`then` is intentionally
   * not surfaced.
   */
  required: boolean;
  /**
   * The first subschema describing this attribute (used to drive value
   * completion + documentation).
   */
  schema: JSONSchema;
}

export type AttributeValueKind =
  | 'enum'
  | 'const'
  | 'example'
  | 'default'
  | 'boolean';

export interface AttributeValueCandidate {
  value: string;
  kind: AttributeValueKind;
}

export interface AttributeValueResult {
  values: AttributeValueCandidate[];
  /**
   * Format names seen across any branch — surfaced as a hint (`format: X`)
   * when there are no concrete values to offer.
   */
  formats: string[];
}

function isObject(value: unknown): value is JSONSchema {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Visit `schema` and every subschema that could conditionally apply at the
 * same level (combinators + if/then/else branches). Used for the permissive
 * "what could possibly appear" pass.
 */
function visitBranches(
  schema: JSONSchema,
  visit: (s: JSONSchema) => void,
): void {
  visit(schema);
  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    const arr = schema[key];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (isObject(item)) visitBranches(item, visit);
      }
    }
  }
  if (isObject(schema.then)) visitBranches(schema.then, visit);
  if (isObject(schema.else)) visitBranches(schema.else, visit);
}

/**
 * Visit `schema` and only its unconditional siblings via `allOf`. Used to
 * collect `required` markers — a property required inside `if`/`then` or one
 * branch of `anyOf` is not unconditionally required, so we don't surface it
 * with the "required" flag.
 */
function visitUnconditional(
  schema: JSONSchema,
  visit: (s: JSONSchema) => void,
): void {
  visit(schema);
  if (Array.isArray(schema.allOf)) {
    for (const item of schema.allOf) {
      if (isObject(item)) visitUnconditional(item, visit);
    }
  }
}

/**
 * Collect every attribute the schema might allow.
 *
 * Walks the root schema's branches looking for `properties.attributes`, then
 * for each found attributes-subschema walks its own branches collecting
 * `properties` entries. Multiple descriptions of the same attribute keep the
 * first seen (the order is: root → allOf → anyOf → oneOf → then → else).
 */
export function collectAttributeNames(rootSchema: JSONSchema): AttributeInfo[] {
  // Permissive pass: every property that could appear in any branch.
  const byName = new Map<string, AttributeInfo>();
  visitBranches(rootSchema, (s) => {
    const props = s.properties;
    if (!isObject(props) || !isObject(props.attributes)) return;
    visitBranches(props.attributes, (attrSchema) => {
      const ap = attrSchema.properties;
      if (!isObject(ap)) return;
      for (const [name, propSchema] of Object.entries(ap)) {
        if (!isObject(propSchema)) continue;
        if (!byName.has(name)) {
          byName.set(name, { name, required: false, schema: propSchema });
        }
      }
    });
  });

  // Strict pass: only unconditional `required` arrays (root + allOf chain).
  const required = new Set<string>();
  visitUnconditional(rootSchema, (s) => {
    const props = s.properties;
    if (!isObject(props) || !isObject(props.attributes)) return;
    visitUnconditional(props.attributes, (attrSchema) => {
      if (!Array.isArray(attrSchema.required)) return;
      for (const r of attrSchema.required) {
        if (typeof r === 'string') required.add(r);
      }
    });
  });

  for (const name of required) {
    const info = byName.get(name);
    if (info) info.required = true;
  }

  return [...byName.values()];
}

/**
 * Collect value completion candidates for a single attribute's subschema.
 *
 * Reads `enum`, `const`, `examples`, `default`, and `type: "boolean"` from
 * every branch and unions them (de-duplicated by string value, keeping the
 * first kind seen for each value).
 */
export function collectAttributeValues(
  schema: JSONSchema,
): AttributeValueResult {
  const seen = new Set<string>();
  const values: AttributeValueCandidate[] = [];
  const formats = new Set<string>();

  function add(value: unknown, kind: AttributeValueKind): void {
    if (value === undefined || value === null) return;
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    if (seen.has(str)) return;
    seen.add(str);
    values.push({ value: str, kind });
  }

  function hasBooleanType(typeValue: unknown): boolean {
    if (typeValue === 'boolean') return true;
    if (Array.isArray(typeValue) && typeValue.includes('boolean')) return true;
    return false;
  }

  visitBranches(schema, (s) => {
    if (Array.isArray(s.enum)) {
      for (const v of s.enum) add(v, 'enum');
    }
    if (s.const !== undefined) {
      add(s.const, 'const');
    }
    if (Array.isArray(s.examples)) {
      for (const v of s.examples) add(v, 'example');
    }
    if (s.default !== undefined) {
      add(s.default, 'default');
    }
    if (hasBooleanType(s.type)) {
      add('true', 'boolean');
      add('false', 'boolean');
    }
    if (typeof s.format === 'string') {
      formats.add(s.format);
    }
  });

  return { values, formats: [...formats] };
}
