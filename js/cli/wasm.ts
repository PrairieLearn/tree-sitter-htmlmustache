import * as path from 'node:path';
import type { Parser, Tree } from 'web-tree-sitter';
import { GRAMMAR_WASM_FILENAME } from '../shared/grammar.js';
import { createTreeSitterRuntime } from '../shared/treeSitterRuntime.js';

let parser: Parser;

export type { Tree };

export async function initializeParser(): Promise<void> {
  const wasmPath = path.resolve(__dirname, '..', '..', GRAMMAR_WASM_FILENAME);
  const runtime = await createTreeSitterRuntime({ grammarWasm: wasmPath });
  parser = runtime.parser;
}

export function parseDocument(source: string): Tree {
  const tree = parser.parse(source);
  if (!tree) {
    throw new Error('Failed to parse document');
  }
  return tree;
}
