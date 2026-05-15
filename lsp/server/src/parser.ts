import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  Language,
  Parser,
  Query,
  type Tree,
} from 'web-tree-sitter';
import { GRAMMAR_WASM_FILENAME } from '../../../js/shared/grammar.js';
import { createTreeSitterRuntime } from '../../../js/shared/treeSitterRuntime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let parser: Parser | null = null;
let language: Language | null = null;

// Logger function - will be set by server.ts
let log: (message: string) => void = console.log;

export function setLogger(logger: (message: string) => void): void {
  log = logger;
}

// Re-export types for other modules
export type { Tree, Query };

/**
 * Initialize the tree-sitter parser with the htmlmustache grammar.
 * Must be called once before parsing any documents.
 */
export async function initializeParser(): Promise<void> {
  log(`Parser initialization starting...`);
  log(`__dirname: ${__dirname}`);

  // Find web-tree-sitter.wasm - it's copied to server/out during build
  const webTsWasmPath = path.resolve(__dirname, 'web-tree-sitter.wasm');
  log(`web-tree-sitter.wasm path: ${webTsWasmPath}`);
  log(`web-tree-sitter.wasm exists: ${fs.existsSync(webTsWasmPath)}`);

  if (!fs.existsSync(webTsWasmPath)) {
    throw new Error(`web-tree-sitter.wasm not found at ${webTsWasmPath}`);
  }

  // Initialize web-tree-sitter with explicit WASM binary
  // Load the grammar WASM file - copied to extension root during build
  // server/out -> server -> extension root
  const grammarWasmPath = path.resolve(__dirname, '..', '..', GRAMMAR_WASM_FILENAME);
  log(`Grammar WASM path: ${grammarWasmPath}`);
  log(`Grammar WASM exists: ${fs.existsSync(grammarWasmPath)}`);

  if (!fs.existsSync(grammarWasmPath)) {
    throw new Error(`${GRAMMAR_WASM_FILENAME} not found at ${grammarWasmPath}`);
  }

  try {
    log(`Reading web-tree-sitter.wasm...`);
    const wasmBinary = fs.readFileSync(webTsWasmPath);
    log(`WASM binary size: ${wasmBinary.length} bytes`);
    log(`Initializing parser runtime...`);
    const runtime = await createTreeSitterRuntime({
      grammarWasm: grammarWasmPath,
      parserInitOptions: {
        wasmBinary: wasmBinary.buffer,
        locateFile: (scriptName: string, scriptDirectory: string) => {
          log(`locateFile called: scriptName=${scriptName}, scriptDirectory=${scriptDirectory}`);
          return path.resolve(__dirname, scriptName);
        },
      },
      treeSitter: { Parser, Language },
    });
    parser = runtime.parser;
    language = runtime.language;
    log(`Language.load() completed successfully`);
    log(`Parser language set successfully`);
  } catch (error) {
    log(`Failed to initialize parser runtime from ${grammarWasmPath}: ${error}`);
    throw error;
  }
}

/**
 * Parse a document and return the syntax tree.
 */
export function parseDocument(text: string): Tree | null {
  if (!parser) {
    console.error('Parser not initialized. Call initializeParser() first.');
    return null;
  }
  return parser.parse(text);
}

/**
 * Get the current parser language for running queries.
 */
export function getLanguage(): Language | null {
  return language;
}

/**
 * Create a tree-sitter query from a query string.
 */
export function createQuery(queryString: string): Query | null {
  if (!language) {
    console.error('Language not loaded. Call initializeParser() first.');
    return null;
  }
  return new Query(language, queryString);
}
