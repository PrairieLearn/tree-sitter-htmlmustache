import type { FormattingOptions } from 'vscode-languageserver/node.js';

import type { FormatDocumentParams } from '../../../../js/formatter/document.js';
import {
  formatDocument,
  formatDocumentRange,
  type Range,
} from '../../../../js/formatter/document.js';
import { createMockDocument, parseText } from '../setup.js';

export const defaultOptions: FormattingOptions = {
  tabSize: 2,
  insertSpaces: true,
};

export function format(
  content: string,
  options: FormattingOptions = defaultOptions,
  params: FormatDocumentParams = {},
): string {
  const tree = parseText(content);
  const document = createMockDocument(content);
  const edits = formatDocument(tree, document, options, params);
  if (edits.length !== 1) {
    throw new Error(`Expected one full-document edit, got ${edits.length}`);
  }
  return edits[0].newText;
}

export function formatWithPrintWidth(
  content: string,
  printWidth: number,
  options: FormattingOptions = defaultOptions,
): string {
  return format(content, options, { printWidth });
}

export function formatRange(
  content: string,
  range: Range,
  options: FormattingOptions = defaultOptions,
  params: FormatDocumentParams = {},
): string {
  const tree = parseText(content);
  const document = createMockDocument(content);
  const edits = formatDocumentRange(tree, document, range, options, params);
  if (edits.length !== 1) {
    throw new Error(`Expected one range edit, got ${edits.length}`);
  }
  return edits[0].newText;
}
