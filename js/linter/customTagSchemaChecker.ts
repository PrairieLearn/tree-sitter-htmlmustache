import type { ErrorObject } from 'ajv';
import localizeEn from 'ajv-i18n/localize/en/index.js';
import type { BalanceNode } from './htmlBalanceChecker.js';
import type { FixableError } from './mustacheChecks.js';
import type {
  CompiledTagSchema,
  SchemaRegistry,
} from '../shared/customTagSchemaLoader.js';
import { getTagName, isHtmlElementType } from '../shared/nodeHelpers.js';

interface AttributeInfo {
  attrNode: BalanceNode;
  valueNode: BalanceNode | null;
  value: string | true;
  dynamic: boolean;
}

interface ElementContext {
  startTag: BalanceNode;
  attributesByName: Map<string, AttributeInfo>;
  dynamicAttributes: Set<string>;
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

function findStartTag(node: BalanceNode): BalanceNode | null {
  return (
    node.children.find(
      (c) => c.type === 'html_start_tag' || c.type === 'html_self_closing_tag',
    ) ?? null
  );
}

function containsMustache(node: BalanceNode | null): boolean {
  if (!node) return false;
  if (node.type.startsWith('mustache_')) return true;
  return node.children.some(containsMustache);
}

function readAttributes(startTag: BalanceNode): Map<string, AttributeInfo> {
  const attributes = new Map<string, AttributeInfo>();
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
    const name = nameNode.text.toLowerCase();
    const value = valueNode ? stripQuotes(valueNode.text) : true;
    attributes.set(name, {
      attrNode: child,
      valueNode,
      value,
      dynamic: containsMustache(child),
    });
  }
  return attributes;
}

function buildAttributeObject(
  element: BalanceNode,
): { data: Record<string, unknown>; context: ElementContext } | null {
  const startTag = findStartTag(element);
  if (!startTag) return null;
  const attributesByName = readAttributes(startTag);
  const dynamicAttributes = new Set<string>();
  const data: Record<string, unknown> = {};
  for (const [name, info] of attributesByName) {
    if (info.dynamic) dynamicAttributes.add(name);
    data[name] = info.value;
  }
  return { data, context: { startTag, attributesByName, dynamicAttributes } };
}

function pathSegments(instancePath: string): string[] {
  return instancePath
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function schemaPathSegments(schemaPath: string): string[] {
  return pathSegments(schemaPath.replace(/^#/, ''));
}

function schemaAtPath(
  schema: Record<string, unknown>,
  schemaPath: string,
): unknown {
  let current: unknown = schema;
  for (const segment of schemaPathSegments(schemaPath)) {
    if (!current || typeof current !== 'object') return null;
    current = Array.isArray(current)
      ? current[Number(segment)]
      : (current as Record<string, unknown>)[segment];
  }
  return current;
}

function collectMentionedAttributes(
  schema: unknown,
  out = new Set<string>(),
): Set<string> {
  if (!schema || typeof schema !== 'object') return out;
  if (Array.isArray(schema)) {
    for (const item of schema) collectMentionedAttributes(item, out);
    return out;
  }
  const obj = schema as Record<string, unknown>;
  if (Array.isArray(obj.required)) {
    for (const name of obj.required) {
      if (typeof name === 'string') out.add(name);
    }
  }
  if (obj.properties && typeof obj.properties === 'object') {
    for (const name of Object.keys(obj.properties)) {
      out.add(name);
    }
  }
  for (const value of Object.values(obj)) {
    collectMentionedAttributes(value, out);
  }
  return out;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const item of a) if (b.has(item)) return true;
  return false;
}

function conditionalAncestorMentionsDynamic(
  schema: Record<string, unknown>,
  schemaPath: string,
  dynamicAttributes: Set<string>,
): boolean {
  const segments = schemaPathSegments(schemaPath);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i] !== 'then' && segments[i] !== 'else') continue;
    const ancestor = schemaAtPath(
      schema,
      `#/${segments.slice(0, i).join('/')}`,
    );
    if (intersects(collectMentionedAttributes(ancestor), dynamicAttributes)) {
      return true;
    }
  }
  return false;
}

function mentionsDynamicAttribute(
  error: ErrorObject,
  context: ElementContext,
  schema: Record<string, unknown>,
): boolean {
  const { dynamicAttributes } = context;
  if (dynamicAttributes.size === 0) return false;
  const segments = pathSegments(error.instancePath);
  if (segments[0] && dynamicAttributes.has(segments[0])) return true;
  const mentioned = collectMentionedAttributes(
    schemaAtPath(schema, error.schemaPath),
  );
  const isCompositionError = ['if', 'not', 'oneOf', 'anyOf', 'allOf'].includes(
    error.keyword,
  );
  if (
    (isCompositionError || segments.length === 0) &&
    intersects(mentioned, dynamicAttributes)
  ) {
    return true;
  }
  return conditionalAncestorMentionsDynamic(
    schema,
    error.schemaPath,
    dynamicAttributes,
  );
}

function formatValueList(values: unknown): string | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.map((value) => JSON.stringify(value)).join(', ');
}

function formatType(type: unknown): string {
  return Array.isArray(type) ? type.join(' or ') : String(type);
}

function constraintPhrase(error: ErrorObject): string | null {
  switch (error.keyword) {
    case 'type':
      return `be ${formatType(error.params.type)}`;
    case 'enum': {
      const allowed = formatValueList(error.params.allowedValues);
      return `be one of: ${allowed ?? 'the allowed values'}`;
    }
    case 'const':
      return `be ${JSON.stringify(error.params.allowedValue)}`;
    case 'minimum':
      return `be >= ${String(error.params.limit)}`;
    case 'maximum':
      return `be <= ${String(error.params.limit)}`;
    case 'format':
      return `match format ${JSON.stringify(error.params.format)}`;
    case 'pattern':
      return `match pattern ${JSON.stringify(error.params.pattern)}`;
  }
  return null;
}

function attributeNameForError(error: ErrorObject): string | null {
  if (
    error.keyword === 'required' &&
    typeof error.params.missingProperty === 'string'
  ) {
    return error.params.missingProperty;
  }
  if (
    error.keyword === 'additionalProperties' &&
    typeof error.params.additionalProperty === 'string'
  ) {
    return error.params.additionalProperty;
  }
  return pathSegments(error.instancePath)[0] ?? null;
}

function messageForError(error: ErrorObject, tag: string): string {
  if (
    error.keyword === 'required' &&
    typeof error.params.missingProperty === 'string'
  ) {
    return `<${tag}> is missing required attribute "${error.params.missingProperty}".`;
  }
  if (
    error.keyword === 'additionalProperties' &&
    typeof error.params.additionalProperty === 'string'
  ) {
    return `Unknown attribute "${error.params.additionalProperty}" on <${tag}>.`;
  }
  const attrName = attributeNameForError(error);
  const phrase = constraintPhrase(error);
  if (attrName && phrase) {
    return `Attribute "${attrName}" on <${tag}> must ${phrase}.`;
  }
  return error.message ?? 'does not satisfy custom tag schema';
}

function nodeForError(
  error: ErrorObject,
  context: ElementContext,
): BalanceNode {
  const attrName = attributeNameForError(error);
  const attr = attrName ? context.attributesByName.get(attrName) : undefined;
  if (error.keyword === 'required') return context.startTag;
  if (attr) {
    return error.keyword === 'additionalProperties'
      ? attr.attrNode
      : (attr.valueNode ?? attr.attrNode);
  }
  return context.startTag;
}

interface MergedError {
  error: ErrorObject;
  message: string;
}

function isBranchOf(child: ErrorObject, wrapper: ErrorObject): boolean {
  return (
    child.instancePath === wrapper.instancePath &&
    child.schemaPath.startsWith(`${wrapper.schemaPath}/`)
  );
}

function mergeErrors(errors: ErrorObject[], tag: string): MergedError[] {
  const byPath = new Map<string, ErrorObject[]>();
  for (const error of errors) {
    const list = byPath.get(error.instancePath);
    if (list) list.push(error);
    else byPath.set(error.instancePath, [error]);
  }

  const result: MergedError[] = [];
  for (const [path, group] of byPath) {
    const attrName = pathSegments(path)[0] ?? null;
    const override = group.find((e) => e.keyword === 'errorMessage');
    if (override) {
      result.push({
        error: override,
        message: override.message ?? 'does not satisfy custom tag schema',
      });
      continue;
    }
    const altWrapper = group.find(
      (e) => e.keyword === 'anyOf' || e.keyword === 'oneOf',
    );
    if (altWrapper) {
      const phrases = Array.from(
        new Set(
          group
            .filter((e) => isBranchOf(e, altWrapper))
            .map((e) => constraintPhrase(e))
            .filter((p): p is string => p !== null),
        ),
      );
      if (attrName && phrases.length > 0) {
        result.push({
          error: altWrapper,
          message: `Attribute "${attrName}" on <${tag}> must ${phrases.join(' or ')}.`,
        });
        continue;
      }
    }
    const wrappers = new Set(['if', 'allOf']);
    for (const error of group) {
      if (wrappers.has(error.keyword) && group.length > 1) continue;
      result.push({ error, message: messageForError(error, tag) });
    }
  }
  return result;
}

function validateElement(
  compiled: CompiledTagSchema,
  element: BalanceNode,
): FixableError[] {
  const tag = getTagName(element)?.toLowerCase();
  if (!tag) return [];
  const built = buildAttributeObject(element);
  if (!built) return [];
  const valid = compiled.validate(built.data);
  if (valid || !compiled.validate.errors) return [];
  const errors = compiled.validate.errors.filter(
    (error) => !mentionsDynamicAttribute(error, built.context, compiled.schema),
  );
  localizeEn(errors.filter((error) => error.keyword !== 'errorMessage'));
  return mergeErrors(errors, tag).map(({ error, message }) => ({
    node: nodeForError(error, built.context),
    message,
  }));
}

export function checkCustomTagSchemas(
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
      if (compiled) errors.push(...validateElement(compiled, node));
    }
    for (const child of node.children) visit(child);
  }

  visit(rootNode);
  return errors;
}
