import {
  Parser as TreeSitterParser,
  Language,
  type Parser,
} from 'web-tree-sitter';

import { GRAMMAR_WASM_FILENAME } from './grammar.js';

export type LocateWasm = string | ((filename: string) => string);

type ParserInitOptions = Parameters<typeof TreeSitterParser.init>[0];

export interface TreeSitterRuntimeOptions {
  /**
   * Locates the grammar WASM. String form is used directly for the grammar;
   * callback form is also passed to web-tree-sitter as locateFile.
   */
  locateWasm?: LocateWasm;
  /** Explicit grammar path/URL for Node-only callers that resolve it already. */
  grammarWasm?: string;
  /** Extra Emscripten options for web-tree-sitter runtime initialization. */
  parserInitOptions?: ParserInitOptions;
  /** Use a caller-provided web-tree-sitter module instance. */
  treeSitter?: {
    Parser: typeof TreeSitterParser;
    Language: typeof Language;
  };
}

export interface TreeSitterRuntime {
  parser: Parser;
  language: Language;
}

export function toLocateFile(
  locateWasm: LocateWasm | undefined,
): ((name: string) => string) | undefined {
  return typeof locateWasm === 'function'
    ? (name) => locateWasm(name)
    : undefined;
}

export function resolveGrammarUrl(locateWasm: LocateWasm): string {
  return typeof locateWasm === 'string'
    ? locateWasm
    : locateWasm(GRAMMAR_WASM_FILENAME);
}

export async function createTreeSitterRuntime(
  options: TreeSitterRuntimeOptions,
): Promise<TreeSitterRuntime> {
  const ParserCtor = options.treeSitter?.Parser ?? TreeSitterParser;
  const LanguageCtor = options.treeSitter?.Language ?? Language;
  const locateFile = toLocateFile(options.locateWasm);
  const initOptions =
    options.parserInitOptions || locateFile
      ? {
          ...options.parserInitOptions,
          ...(locateFile && !options.parserInitOptions?.locateFile
            ? { locateFile }
            : {}),
        }
      : undefined;

  await ParserCtor.init(initOptions);

  const parser = new ParserCtor();
  const grammarWasm =
    options.grammarWasm ??
    (options.locateWasm
      ? resolveGrammarUrl(options.locateWasm)
      : GRAMMAR_WASM_FILENAME);
  const language = await LanguageCtor.load(grammarWasm);
  parser.setLanguage(language);

  return { parser, language };
}
