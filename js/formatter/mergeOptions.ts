/**
 * Pure option merging + indent-unit construction.
 *
 * EditorConfig-aware merging lives in `js/formatter/editorconfig.ts`
 * and layers on top of these results by passing its result as `overrides`.
 */

import type { FormatDocumentParams, FormattingOptions } from './document.js';
import type { HtmlMustacheConfig } from '../shared/configSchema.js';

export const DEFAULT_FORMATTING_OPTIONS: FormattingOptions = {
  tabSize: 2,
  insertSpaces: true,
};

/**
 * Merge base options with `configFile` (indentSize only) and optional
 * `overrides` (tabSize / insertSpaces). Pure; no fs.
 *
 * Priority (low → high): lspOptions < configFile.indentSize < overrides.
 * `insertSpaces` never comes from `configFile` — only `lspOptions` or `overrides`.
 */
export function mergeOptions(
  lspOptions: FormattingOptions,
  configFile?: HtmlMustacheConfig | null,
  overrides?: Partial<FormattingOptions>,
): FormattingOptions {
  let tabSize = lspOptions.tabSize;
  if (configFile?.indentSize !== undefined) tabSize = configFile.indentSize;
  if (overrides?.tabSize !== undefined) tabSize = overrides.tabSize;

  const insertSpaces = overrides?.insertSpaces ?? lspOptions.insertSpaces;

  return { tabSize, insertSpaces };
}

export function createIndentUnit(options: FormattingOptions): string {
  return options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
}

export function formatParamsFromConfig(
  configFile?: HtmlMustacheConfig | null,
  defaults: Pick<FormatDocumentParams, 'printWidth' | 'mustacheSpaces'> = {
    printWidth: 80,
  },
): FormatDocumentParams {
  return {
    customTags: configFile?.customTags,
    printWidth: configFile?.printWidth ?? defaults.printWidth,
    mustacheSpaces: configFile?.mustacheSpaces ?? defaults.mustacheSpaces,
    noBreakDelimiters: configFile?.noBreakDelimiters,
  };
}
