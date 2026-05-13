/**
 * Walks each element whose tag has a registered custom-tag schema and emits
 * warnings when JSON Schema's `deprecated: true` annotation appears at:
 *
 *   1. The tag's root schema (the tag itself is deprecated).
 *   2. An attribute's property schema (the attribute is deprecated).
 *   3. A literal attribute value's subschema (only `const`-keyed branches —
 *      we can't run AJV to match `type`/`format`/`pattern` against the data
 *      from here, so value-level deprecation requires a constant match).
 *   4. A `children.items` branch keyed by `properties.tag.const` (the child
 *      tag is deprecated when used as a child of this parent tag).
 *
 * AJV ignores `deprecated` — it's an annotation, not a validator — so this
 * runs independently of the schema diagnostic pass. Sibling `description`
 * strings are appended to the message as the deprecation reason.
 */

import type { BalanceNode } from './htmlBalanceChecker.js';
import type { FixableError } from './mustacheChecks.js';
import type { SchemaRegistry } from '../shared/customTagSchemaLoader.js';
import {
  getTagName,
  isHtmlElementType,
  isMustacheSection,
} from '../shared/nodeHelpers.js';

type JSONSchema = Record<string, unknown>;

interface DeprecationHit {
  description?: string;
}

function isObject(value: unknown): value is JSONSchema {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function visitBranches(
  schema: JSONSchema,
  visit: (s: JSONSchema) => void,
): void {
  visit(schema);
  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    const arr = schema[key];
    if (Array.isArray(arr)) {
      for (const item of arr) if (isObject(item)) visitBranches(item, visit);
    }
  }
  if (isObject(schema.then)) visitBranches(schema.then, visit);
  if (isObject(schema.else)) visitBranches(schema.else, visit);
}

/**
 * Visit only `schema` and its unconditional siblings via `allOf`. Branches
 *  inside `anyOf`/`oneOf`/`if`/`then`/`else` describe alternate validations
 *  of the *value* — picking a `deprecated: true` flag out of one of them
 *  would mistake a value-level deprecation for an attribute-level one.
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

function findStartTag(node: BalanceNode): BalanceNode | null {
  return (
    node.children.find(
      (c) => c.type === 'html_start_tag' || c.type === 'html_self_closing_tag',
    ) ?? null
  );
}

function stripQuotes(text: string): string {
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

interface AttributeOnTag {
  name: string;
  attrNode: BalanceNode;
  valueNode: BalanceNode | null;
  rawValue: string;
}

function readAttributes(startTag: BalanceNode): AttributeOnTag[] {
  const out: AttributeOnTag[] = [];
  for (const child of startTag.children) {
    if (child.type !== 'html_attribute') continue;
    const nameNode = child.children.find(
      (c) => c.type === 'html_attribute_name',
    );
    if (!nameNode) continue;
    const valueNode =
      child.children.find(
        (c) =>
          c.type === 'html_attribute_value' ||
          c.type === 'html_quoted_attribute_value',
      ) ?? null;
    out.push({
      name: nameNode.text.toLowerCase(),
      attrNode: child,
      valueNode,
      rawValue: valueNode ? stripQuotes(valueNode.text) : '',
    });
  }
  return out;
}

function collectDirectHtmlChildren(
  node: BalanceNode,
  out: BalanceNode[] = [],
): BalanceNode[] {
  for (const child of node.children) {
    if (isHtmlElementType(child)) {
      out.push(child);
    } else if (isMustacheSection(child)) {
      collectDirectHtmlChildren(child, out);
    }
  }
  return out;
}

function description(schema: JSONSchema): string | undefined {
  return typeof schema.description === 'string' && schema.description.length > 0
    ? schema.description
    : undefined;
}

function withReason(base: string, reason?: string): string {
  return reason ? `${base} ${reason}` : base;
}

/**
 * Return the first deprecation hit visible from `schema` or its unconditional
 *  `allOf` siblings. Used for tag-level and attribute-level deprecation.
 */
function structuralDeprecation(schema: JSONSchema): DeprecationHit | null {
  let hit: DeprecationHit | null = null;
  visitUnconditional(schema, (s) => {
    if (hit || s.deprecated !== true) return;
    hit = { description: description(s) };
  });
  return hit;
}

/**
 * Visit every property schema named `attrName` across the root schema's
 *  branches' `properties.attributes.properties`.
 */
function visitAttributeSchemas(
  rootSchema: JSONSchema,
  attrName: string,
  visit: (s: JSONSchema) => void,
): void {
  visitBranches(rootSchema, (s) => {
    const props = s.properties;
    if (!isObject(props) || !isObject(props.attributes)) return;
    visitBranches(props.attributes, (attrsSchema) => {
      const ap = attrsSchema.properties;
      if (!isObject(ap)) return;
      const sub = ap[attrName];
      if (isObject(sub)) visit(sub);
    });
  });
}

function findAttributeDeprecation(
  rootSchema: JSONSchema,
  attrName: string,
): DeprecationHit | null {
  let hit: DeprecationHit | null = null;
  visitAttributeSchemas(rootSchema, attrName, (attrSchema) => {
    if (hit) return;
    hit = structuralDeprecation(attrSchema);
  });
  return hit;
}

function findAttributeValueDeprecation(
  rootSchema: JSONSchema,
  attrName: string,
  rawValue: string,
): DeprecationHit | null {
  let hit: DeprecationHit | null = null;
  visitAttributeSchemas(rootSchema, attrName, (attrSchema) => {
    visitBranches(attrSchema, (s) => {
      if (hit || s.deprecated !== true) return;
      if (s.const !== undefined && String(s.const) === rawValue) {
        hit = { description: description(s) };
      }
    });
  });
  return hit;
}

/**
 * Look through `properties.children.items` branches for one that
 *  - is `deprecated: true`, AND
 *  - has `properties.tag.const === <childTag>`.
 */
function findChildTagDeprecation(
  rootSchema: JSONSchema,
  childTag: string,
): DeprecationHit | null {
  let hit: DeprecationHit | null = null;
  visitBranches(rootSchema, (s) => {
    if (hit) return;
    const props = s.properties;
    if (!isObject(props) || !isObject(props.children)) return;
    const items = (props.children as JSONSchema).items;
    if (!isObject(items)) return;
    visitBranches(items, (itemSchema) => {
      if (hit || itemSchema.deprecated !== true) return;
      const itemProps = itemSchema.properties;
      if (!isObject(itemProps) || !isObject(itemProps.tag)) return;
      if (
        typeof itemProps.tag.const === 'string' &&
        itemProps.tag.const === childTag
      ) {
        hit = { description: description(itemSchema) };
      }
    });
  });
  return hit;
}

export function checkDeprecations(
  rootNode: BalanceNode,
  registry: SchemaRegistry | undefined,
): FixableError[] {
  if (!registry || registry.schemas.size === 0) return [];
  const errors: FixableError[] = [];
  const schemas = registry.schemas;

  function visit(node: BalanceNode): void {
    if (isHtmlElementType(node)) {
      const tag = getTagName(node)?.toLowerCase();
      const compiled = tag ? schemas.get(tag) : undefined;
      const startTag = compiled ? findStartTag(node) : null;
      if (tag && compiled && startTag) {
        const tagHit = structuralDeprecation(compiled.schema);
        if (tagHit) {
          errors.push({
            node: startTag,
            message: withReason(`<${tag}> is deprecated.`, tagHit.description),
          });
        }

        for (const attr of readAttributes(startTag)) {
          const attrHit = findAttributeDeprecation(compiled.schema, attr.name);
          if (attrHit) {
            errors.push({
              node: attr.attrNode,
              message: withReason(
                `Attribute "${attr.name}" on <${tag}> is deprecated.`,
                attrHit.description,
              ),
            });
            continue;
          }
          // Value-level deprecation only fires on literal (non-mustache)
          // values — we'd need to evaluate the mustache to know what it
          // resolves to.
          if (attr.valueNode && !attr.rawValue.includes('{{')) {
            const valueHit = findAttributeValueDeprecation(
              compiled.schema,
              attr.name,
              attr.rawValue,
            );
            if (valueHit) {
              errors.push({
                node: attr.valueNode,
                message: withReason(
                  `Value "${attr.rawValue}" for attribute "${attr.name}" on <${tag}> is deprecated.`,
                  valueHit.description,
                ),
              });
            }
          }
        }

        for (const child of collectDirectHtmlChildren(node)) {
          const childTag = getTagName(child)?.toLowerCase();
          if (!childTag) continue;
          const childHit = findChildTagDeprecation(compiled.schema, childTag);
          if (!childHit) continue;
          const childStartTag = findStartTag(child);
          if (!childStartTag) continue;
          errors.push({
            node: childStartTag,
            message: withReason(
              `<${childTag}> as a child of <${tag}> is deprecated.`,
              childHit.description,
            ),
          });
        }
      }
    }
    for (const child of node.children) visit(child);
  }

  visit(rootNode);
  return errors;
}
