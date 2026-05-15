import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Language,
  Parser,
  Query,
  type Tree,
} from 'web-tree-sitter';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { beforeAll } from 'vitest';
import { createTreeSitterRuntime } from '../../../js/shared/treeSitterRuntime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Global instances shared across tests
let parser: Parser;
let language: Language;

/**
 * Get the initialized parser instance.
 */
export function getParser(): Parser {
  return parser;
}

/**
 * Get the loaded language instance.
 */
export function getTestLanguage(): Language {
  return language;
}

/**
 * Parse text into a tree-sitter Tree.
 */
export function parseText(text: string): Tree {
  const tree = parser.parse(text);
  if (!tree) {
    throw new Error('Failed to parse text');
  }
  return tree;
}

/**
 * Create a query from the language.
 */
export function createTestQuery(queryString: string): Query {
  return new Query(language, queryString);
}

/**
 * Create a mock TextDocument for testing LSP features.
 */
export function createMockDocument(content: string, uri = 'file:///test.mustache'): TextDocument {
  return TextDocument.create(uri, 'htmlmustache', 1, content);
}

// Initialize tree-sitter before all tests
beforeAll(async () => {
  const wasmPath = path.resolve(__dirname, '..', '..', '..', 'tree-sitter-htmlmustache.wasm');
  try {
    const runtime = await createTreeSitterRuntime({
      grammarWasm: wasmPath,
      treeSitter: { Parser, Language },
    });
    parser = runtime.parser;
    language = runtime.language;
  } catch (error) {
    console.error(`Failed to load tree-sitter-htmlmustache.wasm from ${wasmPath}:`, error);
    throw error;
  }
});
