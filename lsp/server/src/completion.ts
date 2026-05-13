import {
  CompletionItem,
  CompletionItemKind,
  CompletionParams,
  InsertTextFormat,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Node as SyntaxNode } from 'web-tree-sitter';
import type { Tree } from './parser.js';
import type { SchemaRegistry } from '../../../js/shared/customTagSchemaLoader.js';
import {
  collectAttributeNames,
  collectAttributeValues,
  type AttributeInfo,
  type AttributeValueResult,
} from './schemaWalker.js';

type Point = { row: number; column: number };

interface AttributeNameCtx {
  kind: 'attribute-name';
  tagName: string;
  existingAttrs: string[];
}

interface AttributeValueCtx {
  kind: 'attribute-value';
  tagName: string;
  attrName: string;
}

type CompletionCtx = AttributeNameCtx | AttributeValueCtx;

export function getCompletions(
  tree: Tree,
  document: TextDocument,
  params: CompletionParams,
  schemaRegistry: SchemaRegistry | undefined,
): CompletionItem[] {
  if (!schemaRegistry || schemaRegistry.schemas.size === 0) return [];

  const point: Point = {
    row: params.position.line,
    column: params.position.character,
  };
  const node = tree.rootNode.descendantForPosition(point);
  if (!node) return [];

  const ctx = resolveContext(node, point);
  if (!ctx) return [];

  const compiled = schemaRegistry.schemas.get(ctx.tagName.toLowerCase());
  if (!compiled) return [];

  if (ctx.kind === 'attribute-name') {
    return buildAttributeNameItems(compiled.schema, ctx.existingAttrs);
  }
  return buildAttributeValueItems(compiled.schema, ctx.attrName);
}

function buildAttributeNameItems(
  rootSchema: Record<string, unknown>,
  existingAttrs: string[],
): CompletionItem[] {
  const attrs = collectAttributeNames(rootSchema);
  const existing = new Set(existingAttrs.map((a) => a.toLowerCase()));
  const items: CompletionItem[] = [];
  for (const attr of attrs) {
    if (existing.has(attr.name.toLowerCase())) continue;
    items.push(buildAttributeNameItem(attr));
  }
  return items;
}

function buildAttributeNameItem(attr: AttributeInfo): CompletionItem {
  const item: CompletionItem = {
    label: attr.name,
    kind: CompletionItemKind.Property,
    insertText: `${attr.name}="$1"`,
    insertTextFormat: InsertTextFormat.Snippet,
    sortText: `${attr.required ? '0' : '1'}_${attr.name}`,
  };
  if (attr.required) {
    item.detail = '(required)';
    item.preselect = true;
  }
  const detailExtras: string[] = [];
  const description = attr.schema.description;
  if (typeof description === 'string') {
    item.documentation = description;
  }
  const format = readFormatHint(attr.schema);
  if (format) detailExtras.push(`format: ${format}`);
  if (detailExtras.length > 0) {
    item.detail = item.detail
      ? `${item.detail} ${detailExtras.join(' ')}`
      : detailExtras.join(' ');
  }
  return item;
}

function buildAttributeValueItems(
  rootSchema: Record<string, unknown>,
  attrName: string,
): CompletionItem[] {
  const attrs = collectAttributeNames(rootSchema);
  const target = attrs.find(
    (a) => a.name.toLowerCase() === attrName.toLowerCase(),
  );
  if (!target) return [];
  const result = collectAttributeValues(target.schema);
  return result.values.map((c) => {
    const item: CompletionItem = {
      label: c.value,
      kind:
        c.kind === 'default'
          ? CompletionItemKind.Value
          : CompletionItemKind.EnumMember,
      insertText: c.value,
    };
    if (c.kind === 'example') item.detail = '(example)';
    else if (c.kind === 'default') {
      item.detail = '(default)';
      item.preselect = true;
    }
    return item;
  });
}

/**
 * Surface the first `format` keyword seen on a top-level branch of the
 * attribute's schema. Only used as a hint string on the completion item's
 * detail — no behavior depends on the format's actual semantics.
 */
function readFormatHint(schema: Record<string, unknown>): string | null {
  const result: AttributeValueResult = collectAttributeValues(schema);
  return result.formats[0] ?? null;
}

/**
 * Climb from the deepest node toward the document root, looking for the
 * enclosing start_tag / self_closing_tag and whether the cursor is inside an
 * attribute value or in the attribute-name slot.
 */
function resolveContext(node: SyntaxNode, point: Point): CompletionCtx | null {
  let attributeValueAncestor: SyntaxNode | null = null;
  let current: SyntaxNode | null = node;

  while (current) {
    if (
      current.type === 'html_attribute_value' ||
      current.type === 'html_quoted_attribute_value'
    ) {
      attributeValueAncestor = current;
    }

    if (
      current.type === 'html_start_tag' ||
      current.type === 'html_self_closing_tag'
    ) {
      const tagNameNode = findChild(current, 'html_tag_name');
      if (!tagNameNode) return null;
      const tagName = tagNameNode.text;

      if (attributeValueAncestor) {
        const attrNode = findAncestor(attributeValueAncestor, 'html_attribute');
        if (!attrNode) return null;
        const attrNameNode = findChild(attrNode, 'html_attribute_name');
        if (!attrNameNode) return null;
        return {
          kind: 'attribute-value',
          tagName,
          attrName: attrNameNode.text,
        };
      }

      return {
        kind: 'attribute-name',
        tagName,
        existingAttrs: collectExistingAttributeNames(current, point),
      };
    }
    current = current.parent;
  }
  return null;
}

function collectExistingAttributeNames(
  tagNode: SyntaxNode,
  point: Point,
): string[] {
  const names: string[] = [];
  for (const child of tagNode.children) {
    if (!child || child.type !== 'html_attribute') continue;
    const nameNode = findChild(child, 'html_attribute_name');
    if (!nameNode) continue;
    // If the cursor is inside this attribute's name, the user is editing it —
    // don't count it as already-present.
    if (pointInNode(point, nameNode)) continue;
    names.push(nameNode.text);
  }
  return names;
}

function findChild(node: SyntaxNode, type: string): SyntaxNode | null {
  for (const child of node.children) {
    if (child && child.type === type) return child;
  }
  return null;
}

function findAncestor(node: SyntaxNode, type: string): SyntaxNode | null {
  let current: SyntaxNode | null = node;
  while (current) {
    if (current.type === type) return current;
    current = current.parent;
  }
  return null;
}

function pointInNode(point: Point, node: SyntaxNode): boolean {
  const { startPosition: s, endPosition: e } = node;
  if (point.row < s.row || point.row > e.row) return false;
  if (point.row === s.row && point.column < s.column) return false;
  if (point.row === e.row && point.column > e.column) return false;
  return true;
}
