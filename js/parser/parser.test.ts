/**
 * Smoke tests for the `./parser` entry. Verifies the JSON AST shape,
 * discriminated-union narrowing on `node.type`, and the `walk` helper.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createParser,
  walk,
  type Parser,
  type SyntaxNode,
  type ParseResult,
} from './index.js';
import { GRAMMAR_WASM_FILENAME } from '../shared/grammar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GRAMMAR_WASM_PATH = path.resolve(REPO_ROOT, GRAMMAR_WASM_FILENAME);

let parser: Parser;

beforeAll(async () => {
  parser = await createParser({
    locateWasm: (name) => {
      if (name === GRAMMAR_WASM_FILENAME) return GRAMMAR_WASM_PATH;
      return path.resolve(REPO_ROOT, 'node_modules', 'web-tree-sitter', name);
    },
  });
});

function findFirst(root: SyntaxNode, type: string): SyntaxNode | undefined {
  let found: SyntaxNode | undefined;
  walk(root, (n) => {
    if (n.type === type) {
      found = n;
      return 'stop';
    }
  });
  return found;
}

describe('createParser', () => {
  it('returns a document root with hasError=false for clean input', () => {
    const result: ParseResult = parser.parse('<p>hi</p>');
    expect(result.rootNode.type).toBe('document');
    expect(result.hasError).toBe(false);
    expect(result.rootNode.hasError).toBe(false);
    expect(Array.isArray(result.rootNode.children)).toBe(true);
  });

  it('exposes position info matching the source', () => {
    const result = parser.parse('<p>hi</p>');
    const el = findFirst(result.rootNode, 'html_element');
    expect(el).toBeDefined();
    expect(el!.startIndex).toBe(0);
    expect(el!.endIndex).toBe('<p>hi</p>'.length);
    expect(el!.startPosition).toEqual({ row: 0, column: 0 });
    expect(el!.text).toBe('<p>hi</p>');
  });

  it('parses mustache sections and interpolations as named nodes', () => {
    const result = parser.parse('{{#items}}<li>{{name}}</li>{{/items}}');
    const section = findFirst(result.rootNode, 'mustache_section');
    expect(section).toBeDefined();
    const interp = findFirst(result.rootNode, 'mustache_interpolation');
    expect(interp).toBeDefined();
    expect(interp!.text).toBe('{{name}}');
  });

  it('omits anonymous tokens from children (named-only)', () => {
    const result = parser.parse('{{name}}');
    const interp = findFirst(result.rootNode, 'mustache_interpolation');
    expect(interp).toBeDefined();
    for (const child of interp!.children) {
      expect(child.type).not.toBe('{{');
      expect(child.type).not.toBe('}}');
    }
  });

  it('reports hasError on malformed input', () => {
    const result = parser.parse('<p>{{/no-open}}');
    expect(result.hasError).toBe(true);
  });

  it('narrows children by type (discriminated union)', () => {
    const result = parser.parse('<p>hi</p>');
    // `type` is a string-literal union, so switching narrows the children shape.
    walk(result.rootNode, (n) => {
      switch (n.type) {
        case 'html_element':
          // ts-expect-error guard would fire if we tried to access a property
          // that doesn't exist on HtmlElementNode. The compile-time narrowing
          // is the contract under test; runtime behavior is incidental.
          expect(Array.isArray(n.children)).toBe(true);
          break;
        default:
          break;
      }
    });
  });
});

describe('walk', () => {
  it('visits every named node pre-order with ancestor chain', () => {
    const result = parser.parse('<p>hi</p>');
    const visited: { type: string; depth: number }[] = [];
    walk(result.rootNode, (n, parents) => {
      visited.push({ type: n.type, depth: parents.length });
    });
    expect(visited[0]).toEqual({ type: 'document', depth: 0 });
    expect(visited.some((v) => v.type === 'html_element' && v.depth === 1)).toBe(true);
  });

  it('honors "skip" — does not descend into the skipped node', () => {
    const result = parser.parse('<p><span>x</span></p>');
    const seen: string[] = [];
    walk(result.rootNode, (n) => {
      seen.push(n.type);
      if (n.type === 'html_element') return 'skip';
    });
    expect(seen.filter((t) => t === 'html_element').length).toBe(1);
    expect(seen).not.toContain('html_start_tag');
  });

  it('honors "stop" — halts entire walk', () => {
    const result = parser.parse('<p><span>x</span></p>');
    let count = 0;
    walk(result.rootNode, () => {
      count += 1;
      if (count === 2) return 'stop';
    });
    expect(count).toBe(2);
  });
});
