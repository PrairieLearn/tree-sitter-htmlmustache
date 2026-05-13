/**
 * Smoke tests for the `./linter` entry. Runs in Node via vitest; `locateWasm`
 * returns absolute file paths (which web-tree-sitter's Emscripten loader
 * accepts in Node contexts).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLinter, DEFAULT_CONFIG, type Linter } from './index.js';
import { GRAMMAR_WASM_FILENAME } from '../shared/grammar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GRAMMAR_WASM_PATH = path.resolve(REPO_ROOT, GRAMMAR_WASM_FILENAME);

let linter: Linter;

beforeAll(async () => {
  linter = await createLinter({
    locateWasm: (name) => {
      if (name === GRAMMAR_WASM_FILENAME) return GRAMMAR_WASM_PATH;
      return path.resolve(REPO_ROOT, 'node_modules', 'web-tree-sitter', name);
    },
  });
});

describe('createLinter', () => {
  it('is idempotent across multiple calls (returns working handles)', async () => {
    const a = await createLinter({ locateWasm: GRAMMAR_WASM_PATH });
    const b = await createLinter({ locateWasm: GRAMMAR_WASM_PATH });
    expect(a.lint('<p></p>', DEFAULT_CONFIG)).toEqual([]);
    expect(b.lint('<p></p>', DEFAULT_CONFIG)).toEqual([]);
  });

  it('accepts string locateWasm as grammar URL', async () => {
    const h = await createLinter({ locateWasm: GRAMMAR_WASM_PATH });
    expect(h.lint('<p></p>', DEFAULT_CONFIG)).toEqual([]);
  });
});

describe('lint', () => {
  it('returns [] for clean HTML', () => {
    expect(linter.lint('<p>hi</p>', DEFAULT_CONFIG)).toEqual([]);
  });

  it('flags unquoted mustache attributes (built-in rule)', () => {
    const d = linter.lint('<a href={{url}}></a>', DEFAULT_CONFIG);
    expect(d.length).toBeGreaterThan(0);
    const rule = d.find((x) => x.ruleName === 'unquotedMustacheAttributes');
    expect(rule).toBeDefined();
    expect(rule!.severity).toBe('error');
    expect(rule!.line).toBe(1);
    expect(rule!.column).toBeGreaterThan(0);
  });

  it('flags self-closing non-void tags with a fix', () => {
    const d = linter.lint('<div/>', DEFAULT_CONFIG);
    const rule = d.find((x) => x.ruleName === 'selfClosingNonVoidTags');
    expect(rule).toBeDefined();
    expect(rule!.fix).toBeDefined();
    expect(rule!.fix!.length).toBeGreaterThanOrEqual(1);
    const [start, end] = rule!.fix![0].range;
    expect(typeof start).toBe('number');
    expect(typeof end).toBe('number');
    expect(end).toBeGreaterThan(start);
  });

  it('flags duplicate attributes', () => {
    const d = linter.lint('<p id="a" id="b"></p>', DEFAULT_CONFIG);
    expect(d.some((x) => x.ruleName === 'duplicateAttributes')).toBe(true);
  });

  it('flags nested duplicate sections', () => {
    const d = linter.lint('{{#x}}{{#x}}hi{{/x}}{{/x}}', DEFAULT_CONFIG);
    expect(d.some((x) => x.ruleName === 'nestedDuplicateSections')).toBe(true);
  });

  it('flags consecutive duplicate sections with a range-deletion fix', () => {
    const d = linter.lint('{{#x}}a{{/x}}{{#x}}b{{/x}}', DEFAULT_CONFIG);
    const rule = d.find((x) => x.ruleName === 'consecutiveDuplicateSections');
    expect(rule).toBeDefined();
    expect(rule!.fix).toBeDefined();
    expect(Array.isArray(rule!.fix)).toBe(true);
    expect(rule!.fix![0].newText).toBe('');
  });

  it('flags unrecognized HTML tags unless registered as customTag', () => {
    const raw = linter.lint('<my-widget></my-widget>', {
      rules: { unrecognizedHtmlTags: 'error' },
    });
    expect(raw.some((x) => x.ruleName === 'unrecognizedHtmlTags')).toBe(true);

    const withCustom = linter.lint('<my-widget></my-widget>', {
      rules: { unrecognizedHtmlTags: 'error' },
      customTags: [{ name: 'my-widget' }],
    });
    expect(withCustom.some((x) => x.ruleName === 'unrecognizedHtmlTags')).toBe(false);
  });

  it('matches a custom selector-based rule', () => {
    const d = linter.lint('<script>x</script>', {
      customRules: [{ id: 'no-script', selector: 'script', message: 'Bare <script> is disallowed' }],
    });
    expect(d.some((x) => x.ruleName === 'no-script')).toBe(true);
  });

  it('rejects per-rule include/exclude at the type level', () => {
    linter.lint('<script>x</script>', {
      customRules: [{
        id: 'no-script',
        selector: 'script',
        message: 'Bare <script> is disallowed',
        // @ts-expect-error include is stripped from the linter CustomRule type
        include: ['questions/**'],
        // @ts-expect-error exclude is stripped from the linter CustomRule type
        exclude: ['**/legacy/**'],
      }],
    });
  });

  it('honors <!-- htmlmustache-disable ruleName --> directives', () => {
    const src = '<!-- htmlmustache-disable duplicateAttributes -->\n<p id="a" id="b"></p>';
    const d = linter.lint(src, DEFAULT_CONFIG);
    expect(d.some((x) => x.ruleName === 'duplicateAttributes')).toBe(false);
  });

  it('honors {{! htmlmustache-disable ruleName }} directives', () => {
    const src = '{{! htmlmustache-disable duplicateAttributes }}\n<p id="a" id="b"></p>';
    const d = linter.lint(src, DEFAULT_CONFIG);
    expect(d.some((x) => x.ruleName === 'duplicateAttributes')).toBe(false);
  });

  it('is pure (same input → same output)', () => {
    const src = '<p id="a" id="b"></p>';
    const a = linter.lint(src, DEFAULT_CONFIG);
    const b = linter.lint(src, DEFAULT_CONFIG);
    expect(b).toEqual(a);
  });

  it('survives 500 iterations without throwing (rough memory / GC sanity)', () => {
    const src = '<div><p>{{name}}</p><span class="x">{{value}}</span></div>';
    for (let i = 0; i < 500; i++) linter.lint(src, DEFAULT_CONFIG);
    expect(true).toBe(true);
  });

  it('reports parse errors without a ruleName', () => {
    const d = linter.lint('<div', DEFAULT_CONFIG);
    const parseErr = d.find((x) => !x.ruleName);
    expect(parseErr).toBeDefined();
    expect(parseErr!.severity).toBe('error');
  });
});

describe('DEFAULT_CONFIG', () => {
  it('has rule entries for every built-in rule', () => {
    const rules = DEFAULT_CONFIG.rules as Record<string, string>;
    expect(rules.nestedDuplicateSections).toBeDefined();
    expect(rules.unquotedMustacheAttributes).toBeDefined();
    expect(rules.consecutiveDuplicateSections).toBeDefined();
    expect(rules.selfClosingNonVoidTags).toBeDefined();
    expect(rules.duplicateAttributes).toBeDefined();
    expect(rules.unescapedEntities).toBeDefined();
    expect(rules.preferMustacheComments).toBeDefined();
    expect(rules.unrecognizedHtmlTags).toBeDefined();
  });
});
