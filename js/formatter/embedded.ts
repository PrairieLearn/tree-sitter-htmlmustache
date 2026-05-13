/**
 * Shared embedded-region formatter used by both the CLI and the browser entry.
 * Takes the already-parsed rootNode, extracts `<script>` / `<style>` regions,
 * and returns a map of startIndex → prettier-formatted content. If no prettier
 * is provided, returns an empty map (caller falls back to leaving regions as-is).
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import { collectEmbeddedRegions } from './embeddedRegions.js';
import type { FormattingOptions } from './document.js';

export const LANGUAGE_TO_PRETTIER_PARSER: Record<string, string> = {
  javascript: 'babel',
  typescript: 'typescript',
  css: 'css',
};

// Structurally compatible with `import('prettier').format` — we only require
// what we actually call. Using `any` for the options bag keeps real prettier
// (whose `Options.plugins` is more specific) assignable to this shape.
export interface PrettierLike {
  format(
    source: string,
    options: PrettierFormatOptions,
  ): string | Promise<string>;
}

export interface PrettierFormatOptions {
  parser: string;
  tabWidth?: number;
  useTabs?: boolean;
  [key: string]: any;
}

export async function formatEmbeddedRegions(
  rootNode: SyntaxNode,
  options: FormattingOptions,
  prettier: PrettierLike | null | undefined,
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (!prettier) return result;

  const regions = collectEmbeddedRegions(rootNode);
  if (regions.length === 0) return result;

  await Promise.all(
    regions.map(async (region) => {
      const parser = LANGUAGE_TO_PRETTIER_PARSER[region.languageId];
      if (!parser) return;
      try {
        const formatted = await prettier.format(region.content, {
          parser,
          tabWidth: options.tabSize,
          useTabs: !options.insertSpaces,
        });
        result.set(region.startIndex, formatted);
      } catch {
        // Snippet had a syntax error — skip, leave the region as-is.
      }
    }),
  );

  return result;
}
