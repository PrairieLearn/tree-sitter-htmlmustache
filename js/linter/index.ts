/**
 * Public `./linter` entry. Returns a handle with `lint(source, config)` that
 * produces diagnostics from built-in rules, custom selector-based rules, and
 * custom-tag JSON-Schema validation.
 *
 * Runtime: web-tree-sitter. No filesystem use — the CLI wraps this with
 * config-file loading and glob filtering.
 */

import { Parser, Language } from 'web-tree-sitter';

import { collectErrors } from './collectErrors.js';
import type { WalkableTree } from './collectErrors.js';
import { toDiagnostic } from './diagnostic.js';
import type { Diagnostic } from './diagnostic.js';
import { GRAMMAR_WASM_FILENAME } from '../shared/grammar.js';
import { loadSchemaRegistry } from '../shared/customTagSchemaLoader.js';
import type {
  SchemaFormat,
  SchemaKeyword,
} from '../shared/customTagSchemaLoader.js';
import { RULE_DEFAULTS } from '../shared/ruleMetadata.js';
import type {
  HtmlMustacheConfig,
  RulesConfig,
  RuleSeverity,
  CustomRule as CustomRuleType,
} from '../shared/configSchema.js';
import type { CustomCodeTagConfig } from '../shared/customCodeTags.js';

/**
 * `include`/`exclude` on custom rules are stripped from the in-memory API
 * surface: there is no filesystem path to match against, so those fields
 * would silently do nothing. The CLI applies them via `customRuleFilter`
 * before calling `lint`.
 */
export type CustomRule = Omit<CustomRuleType, 'include' | 'exclude'>;
export type Config = Omit<
  HtmlMustacheConfig,
  'include' | 'exclude' | 'customRules'
> & { customRules?: CustomRule[] };
export type CustomTag = CustomCodeTagConfig;
export type {
  RulesConfig,
  RuleSeverity,
  Diagnostic,
  SchemaFormat,
  SchemaKeyword,
};

export type LocateWasm = string | ((filename: string) => string);

export interface CreateLinterOptions {
  /**
   * Locates the grammar WASM (`tree-sitter-htmlmustache.wasm`). String form
   * is treated as the URL for the grammar — web-tree-sitter resolves its own
   * `tree-sitter.wasm` via its default `locateFile`. Pass a callback to
   * resolve both names explicitly.
   */
  locateWasm: LocateWasm;
  /**
   * ajv formats registered on the schema validator. Consumers use this to
   * add named formats (e.g. a case-insensitive `pl-boolean`) that their tag
   * schemas reference via `{ "format": "<name>" }`.
   */
  formats?: Record<string, SchemaFormat>;
  /**
   * ajv keywords registered on the schema validator. Thin pass-through to
   * `ajv.addKeyword` — the registration key becomes the keyword name. Use
   * when JSON Schema's built-in vocabulary can't express a domain-specific
   * rule. Errors that carry a `message` flow through unchanged; errors with
   * no message get a generic `<tag>: validation <keyword> failed on <path>.`
   */
  keywords?: Record<string, SchemaKeyword>;
}

export interface Linter {
  lint(source: string, config?: Config): Diagnostic[];
}

/** Default severities for every built-in rule. */
export const DEFAULT_CONFIG: Config = { rules: RULE_DEFAULTS as RulesConfig };

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
 * Create a linter handle. Consumers should cache the result — each call
 * reloads the grammar WASM.
 */
export async function createLinter(opts: CreateLinterOptions): Promise<Linter> {
  const { locateWasm, formats, keywords } = opts;
  const locateFile = toLocateFile(locateWasm);
  // `Parser.init` is idempotent (Emscripten caches the runtime globally), so
  // repeated calls are safe — the first locateFile wins.
  await Parser.init(locateFile ? { locateFile } : undefined);
  const parser = new Parser();
  const language = await Language.load(resolveGrammarUrl(locateWasm));
  parser.setLanguage(language);

  return {
    lint(source, config) {
      const tree = parser.parse(source);
      if (!tree) throw new Error('Failed to parse document');
      try {
        const customTagNames = config?.customTags?.map((t) => t.name);
        const inlineSchemaTags = config?.customTags?.filter(
          (t) => t.schema && typeof t.schema !== 'string',
        );
        const schemaResult = loadSchemaRegistry(inlineSchemaTags, {
          formats,
          keywords,
        });
        const errors = collectErrors(
          tree as unknown as WalkableTree,
          config?.rules,
          customTagNames,
          config?.customRules,
          schemaResult.registry,
          schemaResult.loadErrors,
        );
        return errors.map(toDiagnostic);
      } finally {
        tree.delete();
      }
    },
  };
}
