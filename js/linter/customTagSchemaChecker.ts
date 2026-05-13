import type { ErrorObject } from 'ajv';
import localizeEn from 'ajv-i18n/localize/en/index.js';
import type { BalanceNode } from './htmlBalanceChecker.js';
import type { FixableError } from './mustacheChecks.js';
import type { SchemaRegistry, CompiledTagSchema } from '../shared/customTagSchemaLoader.js';
import { getTagName, isHtmlElementType, isMustacheSection } from '../shared/nodeHelpers.js';

interface ElementJson {
  tag: string;
  attributes: Record<string, unknown>;
  children: ChildJson[];
}

interface ChildJson {
  tag: string;
  attributes: Record<string, unknown>;
}

interface ElementContext {
  element: BalanceNode;
  startTag: BalanceNode;
  attributesByName: Map<string, { attrNode: BalanceNode; valueNode: BalanceNode | null }>;
  children: Array<{ element: BalanceNode; startTag: BalanceNode }>;
  mustacheAttributes: Set<string>;
  mustacheAttributePaths: Set<string>;
}

function stripQuotes(text: string): string {
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function findStartTag(node: BalanceNode): BalanceNode | null {
  return node.children.find(c => c.type === 'html_start_tag' || c.type === 'html_self_closing_tag') ?? null;
}

function readAttributes(startTag: BalanceNode): ElementContext['attributesByName'] {
  const attributes = new Map<string, { attrNode: BalanceNode; valueNode: BalanceNode | null }>();
  for (const child of startTag.children) {
    if (child.type !== 'html_attribute') continue;
    const nameNode = child.children.find(c => c.type === 'html_attribute_name');
    if (!nameNode) continue;
    const valueNode = child.children.find(c => c.type === 'html_attribute_value' || c.type === 'html_quoted_attribute_value') ?? null;
    attributes.set(nameNode.text.toLowerCase(), { attrNode: child, valueNode });
  }
  return attributes;
}

function findAttributeSchema(schema: Record<string, unknown>, attrName: string): Record<string, unknown> | null {
  const rootProperties = schema.properties;
  if (!rootProperties || typeof rootProperties !== 'object' || Array.isArray(rootProperties)) return null;
  const attributesSchema = (rootProperties as Record<string, unknown>).attributes;
  if (!attributesSchema || typeof attributesSchema !== 'object' || Array.isArray(attributesSchema)) return null;
  const properties = (attributesSchema as Record<string, unknown>).properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return null;
  const attrSchema = (properties as Record<string, unknown>)[attrName];
  return attrSchema && typeof attrSchema === 'object' && !Array.isArray(attrSchema) ? attrSchema as Record<string, unknown> : null;
}

function findChildAttributeSchema(schema: Record<string, unknown>, attrName: string): Record<string, unknown> | null {
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return null;
  const children = (properties as Record<string, unknown>).children;
  if (!children || typeof children !== 'object' || Array.isArray(children)) return null;
  const items = (children as Record<string, unknown>).items;
  if (!items || typeof items !== 'object' || Array.isArray(items)) return null;
  return findAttributeSchema(items as Record<string, unknown>, attrName);
}

function schemaType(schema: Record<string, unknown>): string | null {
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type)) return schema.type.find(t => typeof t === 'string') as string | undefined ?? null;
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branches = schema[key];
    if (Array.isArray(branches)) {
      for (const branch of branches) {
        if (branch && typeof branch === 'object' && !Array.isArray(branch)) {
          const type = schemaType(branch as Record<string, unknown>);
          if (type) return type;
        }
      }
    }
  }
  return null;
}

function sentinelFor(schema: Record<string, unknown> | null, original: string): unknown {
  if (!schema) return original;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  const type = schemaType(schema);
  if (type === 'boolean') return true;
  if (type === 'integer' || type === 'number') {
    return typeof schema.minimum === 'number' && schema.minimum > 0 ? schema.minimum : 0;
  }
  if (type === 'string') return '';
  return original;
}

function literalValueFor(schema: Record<string, unknown> | null, rawValue: string, hasValue: boolean): unknown {
  if (!hasValue && schemaType(schema ?? {}) === 'boolean') return true;
  return rawValue;
}

function readAttributeJson(startTag: BalanceNode, compiled: CompiledTagSchema): { attributes: Record<string, unknown>; attributesByName: ElementContext['attributesByName']; mustacheAttributes: Set<string> } {
  const attributesByName = readAttributes(startTag);
  const attributes: Record<string, unknown> = {};
  const mustacheAttributes = new Set<string>();
  for (const [name, nodes] of attributesByName) {
    const rawValue = nodes.valueNode ? stripQuotes(nodes.valueNode.text) : '';
    if (rawValue.includes('{{')) {
      mustacheAttributes.add(name);
      attributes[name] = sentinelFor(findAttributeSchema(compiled.schema, name), rawValue);
    } else {
      attributes[name] = literalValueFor(findAttributeSchema(compiled.schema, name), rawValue, nodes.valueNode !== null);
    }
  }
  return { attributes, attributesByName, mustacheAttributes };
}

function collectDirectHtmlChildren(node: BalanceNode, out: Array<{ element: BalanceNode; startTag: BalanceNode }>): void {
  for (const child of node.children) {
    if (isHtmlElementType(child)) {
      const startTag = findStartTag(child);
      if (startTag) out.push({ element: child, startTag });
      continue;
    }
    if (isMustacheSection(child)) {
      collectDirectHtmlChildren(child, out);
    }
  }
}

function buildChildJson(child: BalanceNode, compiled: CompiledTagSchema, childIndex: number, mustacheAttributePaths: Set<string>): ChildJson | null {
  const tag = getTagName(child)?.toLowerCase();
  const startTag = findStartTag(child);
  if (!tag || !startTag) return null;
  const attributes: Record<string, unknown> = {};
  for (const [name, nodes] of readAttributes(startTag)) {
    const rawValue = nodes.valueNode ? stripQuotes(nodes.valueNode.text) : '';
    const schema = findChildAttributeSchema(compiled.schema, name);
    if (rawValue.includes('{{')) {
      mustacheAttributePaths.add(`/children/${childIndex}/attributes/${name}`);
      attributes[name] = sentinelFor(schema, rawValue);
    } else {
      attributes[name] = literalValueFor(schema, rawValue, nodes.valueNode !== null);
    }
  }
  return { tag, attributes };
}

function buildElementJson(element: BalanceNode, compiled: CompiledTagSchema): { json: ElementJson; context: ElementContext } | null {
  const tag = getTagName(element)?.toLowerCase();
  const startTag = findStartTag(element);
  if (!tag || !startTag) return null;
  const { attributes, attributesByName, mustacheAttributes } = readAttributeJson(startTag, compiled);
  const childNodes: ElementContext['children'] = [];
  collectDirectHtmlChildren(element, childNodes);
  const mustacheAttributePaths = new Set<string>();
  return {
    json: {
      tag,
      attributes,
      children: childNodes.map((c, i) => buildChildJson(c.element, compiled, i, mustacheAttributePaths)).filter((c): c is ChildJson => c !== null),
    },
    context: { element, startTag, attributesByName, children: childNodes, mustacheAttributes, mustacheAttributePaths },
  };
}

function pathSegments(instancePath: string): string[] {
  return instancePath.split('/').filter(Boolean).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function schemaPathSegments(schemaPath: string): string[] {
  return pathSegments(schemaPath.replace(/^#/, ''));
}

function schemaAtPath(schema: Record<string, unknown>, schemaPath: string): unknown {
  let current: unknown = schema;
  for (const segment of schemaPathSegments(schemaPath)) {
    if (!current || typeof current !== 'object') return null;
    current = Array.isArray(current)
      ? current[Number(segment)]
      : (current as Record<string, unknown>)[segment];
  }
  return current;
}

function collectMentionedAttributes(schema: unknown, out = new Set<string>()): Set<string> {
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
  if (obj.properties && typeof obj.properties === 'object' && !Array.isArray(obj.properties)) {
    for (const name of Object.keys(obj.properties)) out.add(name);
  }
  for (const value of Object.values(obj)) collectMentionedAttributes(value, out);
  return out;
}

function childMustacheAttributeNames(paths: Set<string>, childIndex?: number): Set<string> {
  const names = new Set<string>();
  for (const attrPath of paths) {
    const segments = pathSegments(attrPath);
    if (childIndex !== undefined && segments[0] === 'children' && Number(segments[1]) !== childIndex) continue;
    const attributesAt = segments.indexOf('attributes');
    if (attributesAt >= 0 && segments[attributesAt + 1]) names.add(segments[attributesAt + 1]);
  }
  return names;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const item of a) {
    if (b.has(item)) return true;
  }
  return false;
}

function conditionalAncestorMentionsMustache(
  schema: Record<string, unknown>,
  schemaPath: string,
  mustacheNames: Set<string>,
): boolean {
  const segments = schemaPathSegments(schemaPath);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i] !== 'then' && segments[i] !== 'else') continue;
    const ancestor = schemaAtPath(schema, `#/${segments.slice(0, i).join('/')}`);
    if (intersects(collectMentionedAttributes(ancestor), mustacheNames)) return true;
  }
  return false;
}

function mentionsMustacheAttribute(error: ErrorObject, context: ElementContext, schema: Record<string, unknown>): boolean {
  const { mustacheAttributes, mustacheAttributePaths } = context;
  if (mustacheAttributes.size === 0 && mustacheAttributePaths.size === 0) return false;
  const instancePath = error.instancePath;
  for (const attrPath of mustacheAttributePaths) {
    if (instancePath === attrPath || instancePath.startsWith(`${attrPath}/`)) return true;
  }
  const segments = pathSegments(error.instancePath);
  for (const attr of mustacheAttributes) {
    if (segments[0] === 'attributes' && segments[1] === attr) return true;
  }
  const mentioned = collectMentionedAttributes(schemaAtPath(schema, error.schemaPath));
  const isCompositionError = ['if', 'not', 'oneOf', 'anyOf', 'allOf'].includes(error.keyword);
  if (isCompositionError && (segments.length === 0 || segments[0] === 'attributes') && intersects(mentioned, mustacheAttributes)) return true;
  if ((segments.length === 0 || segments[0] === 'attributes') && conditionalAncestorMentionsMustache(schema, error.schemaPath, mustacheAttributes)) return true;
  if (segments[0] === 'children') {
    const childIndex = Number(segments[1]);
    const sameChildMustache = childMustacheAttributeNames(mustacheAttributePaths, Number.isInteger(childIndex) ? childIndex : undefined);
    if (isCompositionError && intersects(mentioned, sameChildMustache)) return true;
    if (conditionalAncestorMentionsMustache(schema, error.schemaPath, sameChildMustache)) return true;
  }
  return false;
}

function childIndexFromError(error: ErrorObject): number | null {
  const segments = pathSegments(error.instancePath);
  const childrenAt = segments.indexOf('children');
  if (childrenAt >= 0) {
    const maybeIndex = Number(segments[childrenAt + 1]);
    if (Number.isInteger(maybeIndex)) return maybeIndex;
  }
  return null;
}

function formatValueList(values: unknown): string | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.map(value => JSON.stringify(value)).join(', ');
}

function formatType(type: unknown): string {
  return Array.isArray(type) ? type.join(' or ') : String(type);
}

function messageForError(error: ErrorObject, json: ElementJson): string {
  const segments = pathSegments(error.instancePath);
  const tag = json.tag;

  if (segments[0] === 'attributes') {
    if (error.keyword === 'required' && typeof error.params.missingProperty === 'string') {
      return `<${tag}> is missing required attribute "${error.params.missingProperty}".`;
    }
    if (error.keyword === 'additionalProperties' && typeof error.params.additionalProperty === 'string') {
      return `Unknown attribute "${error.params.additionalProperty}" on <${tag}>.`;
    }

    const attrName = segments[1];
    if (attrName) {
      if (error.keyword === 'enum') {
        const allowed = formatValueList(error.params.allowedValues);
        return `Attribute "${attrName}" on <${tag}> must be one of: ${allowed ?? 'the allowed values'}.`;
      }
      if (error.keyword === 'const') {
        return `Attribute "${attrName}" on <${tag}> must be ${JSON.stringify(error.params.allowedValue)}.`;
      }
      if (error.keyword === 'type') {
        return `Attribute "${attrName}" on <${tag}> must be ${formatType(error.params.type)}.`;
      }
      if (error.keyword === 'minimum') {
        return `Attribute "${attrName}" on <${tag}> must be >= ${String(error.params.limit)}.`;
      }
      if (error.keyword === 'maximum') {
        return `Attribute "${attrName}" on <${tag}> must be <= ${String(error.params.limit)}.`;
      }
    }
  }

  if (segments[0] === 'children') {
    const childIndex = Number(segments[1]);
    const child = Number.isInteger(childIndex) ? json.children[childIndex] : undefined;
    if (child && segments[2] === 'tag' && error.keyword === 'const') {
      return `<${tag}> only allows <${String(error.params.allowedValue)}> children; found <${child.tag}>.`;
    }
    if (child && segments[2] === 'attributes') {
      if (error.keyword === 'required' && typeof error.params.missingProperty === 'string') {
        return `<${child.tag}> child of <${tag}> is missing required attribute "${error.params.missingProperty}".`;
      }
      if (error.keyword === 'additionalProperties' && typeof error.params.additionalProperty === 'string') {
        return `Unknown attribute "${error.params.additionalProperty}" on <${child.tag}> child of <${tag}>.`;
      }
      const attrName = segments[3];
      if (attrName) {
        if (error.keyword === 'enum') {
          const allowed = formatValueList(error.params.allowedValues);
          return `Attribute "${attrName}" on <${child.tag}> child of <${tag}> must be one of: ${allowed ?? 'the allowed values'}.`;
        }
        if (error.keyword === 'const') {
          return `Attribute "${attrName}" on <${child.tag}> child of <${tag}> must be ${JSON.stringify(error.params.allowedValue)}.`;
        }
        if (error.keyword === 'type') {
          return `Attribute "${attrName}" on <${child.tag}> child of <${tag}> must be ${formatType(error.params.type)}.`;
        }
        if (error.keyword === 'minimum') {
          return `Attribute "${attrName}" on <${child.tag}> child of <${tag}> must be >= ${String(error.params.limit)}.`;
        }
        if (error.keyword === 'maximum') {
          return `Attribute "${attrName}" on <${child.tag}> child of <${tag}> must be <= ${String(error.params.limit)}.`;
        }
      }
    }
  }

  return error.message ?? 'does not satisfy custom tag schema';
}

function nodeForError(error: ErrorObject, context: ElementContext): BalanceNode {
  const segments = pathSegments(error.instancePath);
  if (segments[0] === 'attributes') {
    const attrName = typeof error.params.additionalProperty === 'string'
      ? error.params.additionalProperty
      : segments[1];
    const attr = attrName ? context.attributesByName.get(attrName) : undefined;
    if (error.keyword === 'additionalProperties') return attr?.attrNode ?? context.startTag;
    if (attr) return attr.valueNode ?? attr.attrNode;
    return context.startTag;
  }
  const childIndex = childIndexFromError(error);
  if (childIndex !== null) return context.children[childIndex]?.startTag ?? context.startTag;
  return context.startTag;
}

function validateElement(compiled: CompiledTagSchema, element: BalanceNode): FixableError[] {
  const built = buildElementJson(element, compiled);
  if (!built) return [];
  const valid = compiled.validate(built.json);
  if (valid || !compiled.validate.errors) return [];
  const errors = compiled.validate.errors.filter(error => !mentionsMustacheAttribute(error, built.context, compiled.schema));
  localizeEn(errors);
  return errors.map(error => ({
    node: nodeForError(error, built.context),
    message: messageForError(error, built.json),
  }));
}

export function checkCustomTagSchemas(rootNode: BalanceNode, registry: SchemaRegistry | undefined): FixableError[] {
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
