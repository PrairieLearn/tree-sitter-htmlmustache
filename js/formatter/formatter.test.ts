/**
 * Smoke tests for the `./formatter` entry. Runs in Node via vitest;
 * `locateWasm` returns absolute file paths.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFormatter, type Formatter, type PrettierLike } from './index.js';
import { GRAMMAR_WASM_FILENAME } from '../shared/grammar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GRAMMAR_WASM_PATH = path.resolve(REPO_ROOT, GRAMMAR_WASM_FILENAME);

let formatter: Formatter;

beforeAll(async () => {
  formatter = await createFormatter({
    locateWasm: (name) => {
      if (name === GRAMMAR_WASM_FILENAME) return GRAMMAR_WASM_PATH;
      return path.resolve(REPO_ROOT, 'node_modules', 'web-tree-sitter', name);
    },
  });
});

describe('format', () => {
  it('formats nested blocks', async () => {
    const out = await formatter.format('<div><p>hi</p></div>');
    expect(out).toBe('<div>\n  <p>hi</p>\n</div>\n');
  });

  it('is idempotent', async () => {
    const src = '<div><p>{{name}}</p></div>';
    const once = await formatter.format(src);
    const twice = await formatter.format(once);
    expect(twice).toBe(once);
  });

  it('respects printWidth + indentSize from config', async () => {
    const out = await formatter.format('<div><p>hi</p></div>', { indentSize: 4 });
    expect(out).toBe('<div>\n    <p>hi</p>\n</div>\n');
  });

  it('applies mustacheSpaces from config', async () => {
    const out = await formatter.format('<p>{{name}}</p>', { mustacheSpaces: true });
    expect(out).toBe('<p>{{ name }}</p>\n');
  });

  it('leaves <script> body untouched when no prettier provided', async () => {
    const src = '<script>var  a=1 ;</script>';
    const out = await formatter.format(src);
    expect(out).toContain('var  a=1 ;');
  });

  it('formats <script> body via injected prettier (per-call)', async () => {
    const prettier: PrettierLike = {
      format: (src, opts) => {
        expect(opts.parser).toBe('babel');
        return `/* PRETTIER-${src.trim()} */\n`;
      },
    };
    const out = await formatter.format('<script>var a=1;</script>', undefined, { prettier });
    expect(out).toContain('/* PRETTIER-var a=1; */');
  });

  it('uses factory-level prettier by default', async () => {
    const prettier: PrettierLike = {
      format: () => 'FACTORY_OUT\n',
    };
    const h = await createFormatter({ locateWasm: GRAMMAR_WASM_PATH, prettier });
    const out = await h.format('<script>var a=1;</script>');
    expect(out).toContain('FACTORY_OUT');
  });
});
