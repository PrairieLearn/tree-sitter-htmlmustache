/**
 * Public `./parser` entry. Returns a typed plain-JSON AST that consumers can
 * traverse to build their own validators, linters, or formatters without
 * depending on web-tree-sitter at runtime — the tree owns no wasm handles.
 *
 * Node-type definitions live in `nodeTypes.generated.ts`, regenerated from
 * `src/node-types.json` by `scripts/generate-ast-types.ts` whenever the
 * grammar changes. Only *named* nodes are included (anonymous tokens like
 * `{{`, `}}`, `<`, `=` are omitted — their position is implied by parents).
 */

import {
  Parser as TSParser,
  Language,
  type Node as TSNode,
} from 'web-tree-sitter';
import { GRAMMAR_WASM_FILENAME } from '../shared/grammar.js';
import type { SyntaxNode, NodeType, Position } from './nodeTypes.generated.js';

export type { SyntaxNode, NodeType, Position };
export type {
  BaseNode,
  DocumentNode,
  HtmlElementNode,
  HtmlStartTagNode,
  HtmlEndTagNode,
  HtmlSelfClosingTagNode,
  HtmlAttributeNode,
  HtmlAttributeNameNode,
  HtmlAttributeValueNode,
  HtmlQuotedAttributeValueNode,
  HtmlScriptElementNode,
  HtmlStyleElementNode,
  HtmlRawElementNode,
  HtmlTagNameNode,
  HtmlDoctypeNode,
  HtmlEntityNode,
  HtmlCommentNode,
  MustacheInterpolationNode,
  MustacheTripleNode,
  MustacheCommentNode,
  MustachePartialNode,
  MustacheSectionNode,
  MustacheSectionBeginNode,
  MustacheSectionEndNode,
  MustacheInvertedSectionNode,
  MustacheInvertedSectionBeginNode,
  MustacheInvertedSectionEndNode,
  MustacheAttributeNode,
  MustacheIdentifierNode,
  MustachePathExpressionNode,
  MustacheTagNameNode,
  TextNode,
  ErrorNode,
} from './nodeTypes.generated.js';

export interface ParseResult {
  rootNode: SyntaxNode;
  /** Whether any subtree contains a parse error. */
  hasError: boolean;
}

/** Return `'skip'` to skip a node's subtree, `'stop'` to halt the entire walk. */
export type VisitResult = void | 'skip' | 'stop';

export type Visitor = (
  node: SyntaxNode,
  parents: readonly SyntaxNode[],
) => VisitResult;

export type LocateWasm = string | ((filename: string) => string);

export interface CreateParserOptions {
  /**
   * Locates the grammar WASM (`tree-sitter-htmlmustache.wasm`). String form
   * is treated as the URL for the grammar — web-tree-sitter resolves its own
   * `tree-sitter.wasm` via its default `locateFile`. Pass a callback to
   * resolve both names explicitly.
   */
  locateWasm: LocateWasm;
}

export interface Parser {
  /** Parse `source` into a plain-JSON AST. Throws on internal parser failure. */
  parse(source: string): ParseResult;
}

function toLocateFile(
  locateWasm: LocateWasm,
): ((name: string) => string) | undefined {
  return typeof locateWasm === 'function'
    ? (name) => locateWasm(name)
    : undefined;
}

function resolveGrammarUrl(locateWasm: LocateWasm): string {
  return typeof locateWasm === 'string'
    ? locateWasm
    : locateWasm(GRAMMAR_WASM_FILENAME);
}

function toJSON(node: TSNode): SyntaxNode {
  const children: SyntaxNode[] = [];
  for (const child of node.namedChildren) {
    if (child) children.push(toJSON(child));
  }
  return {
    type: node.type,
    startPosition: {
      row: node.startPosition.row,
      column: node.startPosition.column,
    },
    endPosition: { row: node.endPosition.row, column: node.endPosition.column },
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    text: node.text,
    isMissing: node.isMissing,
    hasError: node.hasError,
    children,
  } as SyntaxNode;
}

/**
 * Pre-order depth-first walk over the JSON AST. The visitor receives each
 * node and the chain of its ancestors (root first, immediate parent last).
 * Return `'skip'` to skip descending; `'stop'` to abort the entire walk.
 */
export function walk(root: SyntaxNode, visit: Visitor): void {
  const parents: SyntaxNode[] = [];
  function descend(node: SyntaxNode): boolean {
    const result = visit(node, parents);
    if (result === 'stop') return false;
    if (result === 'skip') return true;
    parents.push(node);
    try {
      for (const child of node.children) {
        if (!descend(child)) return false;
      }
    } finally {
      parents.pop();
    }
    return true;
  }
  descend(root);
}

/**
 * Create a parser handle. Consumers should cache the result — each call
 * reloads the grammar WASM.
 */
export async function createParser(opts: CreateParserOptions): Promise<Parser> {
  const { locateWasm } = opts;
  const locateFile = toLocateFile(locateWasm);
  await TSParser.init(locateFile ? { locateFile } : undefined);
  const parser = new TSParser();
  const language = await Language.load(resolveGrammarUrl(locateWasm));
  parser.setLanguage(language);

  return {
    parse(source) {
      const tree = parser.parse(source);
      if (!tree) throw new Error('Failed to parse document');
      try {
        const rootNode = toJSON(tree.rootNode);
        return { rootNode, hasError: rootNode.hasError };
      } finally {
        tree.delete();
      }
    },
  };
}
