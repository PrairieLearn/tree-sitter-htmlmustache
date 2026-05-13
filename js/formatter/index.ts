/**
 * Public `./formatter` entry. Returns a handle with `format(source, config)`
 * that pretty-prints HTML+Mustache. Embedded scripts/styles and custom code
 * tags are delegated to a caller-supplied `prettier`.
 *
 * Runtime: web-tree-sitter + (optional) prettier. No filesystem use — the
 * CLI wraps this with EditorConfig + .htmlmustache.jsonc loading.
 */

import { Parser, Language } from 'web-tree-sitter';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { formatDocument } from './document.js';
import type { FormattingOptions } from './document.js';
import { mergeOptions } from './mergeOptions.js';
import { formatEmbeddedRegions } from './embedded.js';
import type { PrettierLike } from './embedded.js';
import { GRAMMAR_WASM_FILENAME } from '../shared/grammar.js';
import type { HtmlMustacheConfig } from '../shared/configSchema.js';
import type { CustomCodeTagConfig } from '../shared/customCodeTags.js';

export type Config = Omit<
  HtmlMustacheConfig,
  'include' | 'exclude' | 'customRules'
>;
export type CustomTag = CustomCodeTagConfig;
export type { PrettierLike, FormattingOptions };

export type LocateWasm = string | ((filename: string) => string);

export interface CreateFormatterOptions {
  locateWasm: LocateWasm;
  /** Default prettier used for embedded-region formatting. */
  prettier?: PrettierLike;
}

export interface FormatOptions {
  /** Override the factory-level prettier for this call. */
  prettier?: PrettierLike;
}

export interface Formatter {
  format(
    source: string,
    config?: Config,
    opts?: FormatOptions,
  ): Promise<string>;
}

const DEFAULT_FORMATTING_OPTIONS: FormattingOptions = {
  tabSize: 2,
  insertSpaces: true,
};

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

/**
 * Create a formatter handle. Consumers should cache the result — each call
 * reloads the grammar WASM.
 */
export async function createFormatter(
  opts: CreateFormatterOptions,
): Promise<Formatter> {
  const { locateWasm, prettier: factoryPrettier } = opts;
  const locateFile = toLocateFile(locateWasm);
  await Parser.init(locateFile ? { locateFile } : undefined);
  const parser = new Parser();
  const language = await Language.load(resolveGrammarUrl(locateWasm));
  parser.setLanguage(language);

  return {
    async format(source, config, callOpts) {
      const prettier = callOpts?.prettier ?? factoryPrettier;
      const options = mergeOptions(DEFAULT_FORMATTING_OPTIONS, config ?? null);
      const tree = parser.parse(source);
      if (!tree) throw new Error('Failed to parse document');
      try {
        const embeddedFormatted = await formatEmbeddedRegions(
          tree.rootNode,
          options,
          prettier,
        );
        const document = TextDocument.create(
          'file:///input',
          'htmlmustache',
          1,
          source,
        );
        const edits = formatDocument(tree, document, options, {
          customTags: config?.customTags,
          printWidth: config?.printWidth,
          mustacheSpaces: config?.mustacheSpaces,
          noBreakDelimiters: config?.noBreakDelimiters,
          embeddedFormatted:
            embeddedFormatted.size > 0 ? embeddedFormatted : undefined,
        });
        return edits.length === 0 ? source : edits[0].newText;
      } finally {
        tree.delete();
      }
    },
  };
}
