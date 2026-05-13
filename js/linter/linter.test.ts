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
    expect(withCustom.some((x) => x.ruleName === 'unrecognizedHtmlTags')).toBe(
      false,
    );
  });

  it('matches a custom selector-based rule', () => {
    const d = linter.lint('<script>x</script>', {
      customRules: [
        {
          id: 'no-script',
          selector: 'script',
          message: 'Bare <script> is disallowed',
        },
      ],
    });
    expect(d.some((x) => x.ruleName === 'no-script')).toBe(true);
  });

  it('rejects per-rule include/exclude at the type level', () => {
    linter.lint('<script>x</script>', {
      customRules: [
        {
          id: 'no-script',
          selector: 'script',
          message: 'Bare <script> is disallowed',
          // @ts-expect-error include is stripped from the linter CustomRule type
          include: ['questions/**'],
          // @ts-expect-error exclude is stripped from the linter CustomRule type
          exclude: ['**/legacy/**'],
        },
      ],
    });
  });

  it('honors <!-- htmlmustache-disable ruleName --> directives', () => {
    const src =
      '<!-- htmlmustache-disable duplicateAttributes -->\n<p id="a" id="b"></p>';
    const d = linter.lint(src, DEFAULT_CONFIG);
    expect(d.some((x) => x.ruleName === 'duplicateAttributes')).toBe(false);
  });

  it('honors {{! htmlmustache-disable ruleName }} directives', () => {
    const src =
      '{{! htmlmustache-disable duplicateAttributes }}\n<p id="a" id="b"></p>';
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

describe('createLinter formats hook', () => {
  const BOOLEAN_STRINGS = new Set([
    'true',
    't',
    '1',
    'yes',
    'y',
    'on',
    'false',
    'f',
    '0',
    'no',
    'n',
    'off',
  ]);
  const isBooleanString = (v: string) => BOOLEAN_STRINGS.has(v.toLowerCase());

  it('lets a registered format gate schema diagnostics', async () => {
    const handle = await createLinter({
      locateWasm: (name) => {
        if (name === GRAMMAR_WASM_FILENAME) return GRAMMAR_WASM_PATH;
        return path.resolve(REPO_ROOT, 'node_modules', 'web-tree-sitter', name);
      },
      formats: { 'pl-boolean': isBooleanString },
    });

    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: {
            answers: { type: 'string', format: 'pl-boolean' },
          },
          required: ['answers'],
        },
      },
    };

    const ok = handle.lint('<pl-card answers="Yes"></pl-card>', {
      rules: { customTagSchema: 'error' },
      customTags: [{ name: 'pl-card', schema }],
    });
    expect(ok.filter((d) => d.ruleName === 'customTagSchema')).toEqual([]);

    const bad = handle.lint('<pl-card answers="maybe"></pl-card>', {
      rules: { customTagSchema: 'error' },
      customTags: [{ name: 'pl-card', schema }],
    });
    expect(bad.some((d) => d.ruleName === 'customTagSchema')).toBe(true);
  });
});

describe('createLinter keywords hook', () => {
  it('exposes a consumer-registered keyword to schemas', async () => {
    interface ErroringValidator {
      (schema: unknown, data: unknown): boolean;
      errors?: Array<{
        keyword: string;
        message: string;
        instancePath?: string;
      }>;
    }

    const uniqueChildText: ErroringValidator = function uniqueChildText(
      _schema,
      data,
    ) {
      if (!Array.isArray(data)) return true;
      const seen = new Set<string>();
      for (const child of data) {
        const text =
          child && typeof child === 'object'
            ? (child as { text?: unknown }).text
            : undefined;
        if (typeof text !== 'string') continue;
        if (seen.has(text)) {
          uniqueChildText.errors = [
            {
              keyword: 'unique-child-text',
              message: `duplicate child text "${text}"`,
            },
          ];
          return false;
        }
        seen.add(text);
      }
      return true;
    };

    const handle = await createLinter({
      locateWasm: (name) => {
        if (name === GRAMMAR_WASM_FILENAME) return GRAMMAR_WASM_PATH;
        return path.resolve(REPO_ROOT, 'node_modules', 'web-tree-sitter', name);
      },
      keywords: {
        'unique-child-text': {
          type: 'array',
          errors: true,
          validate: uniqueChildText,
        },
      },
    });

    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { children: { 'unique-child-text': true } },
    };

    const ok = handle.lint('<pl-list><li>a</li><li>b</li></pl-list>', {
      rules: { customTagSchema: 'error' },
      customTags: [{ name: 'pl-list', schema }],
    });
    expect(ok.filter((d) => d.ruleName === 'customTagSchema')).toEqual([]);

    const bad = handle.lint('<pl-list><li>a</li><li>a</li></pl-list>', {
      rules: { customTagSchema: 'error' },
      customTags: [{ name: 'pl-list', schema }],
    });
    const diag = bad.find((d) => d.ruleName === 'customTagSchema');
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('duplicate child text "a"');
  });

  it('falls back to a generic phrase when the keyword leaves no message', async () => {
    const handle = await createLinter({
      locateWasm: (name) => {
        if (name === GRAMMAR_WASM_FILENAME) return GRAMMAR_WASM_PATH;
        return path.resolve(REPO_ROOT, 'node_modules', 'web-tree-sitter', name);
      },
      keywords: {
        'always-fails': {
          errors: false,
          validate: () => false,
        },
      },
    });

    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      'always-fails': true,
    };

    const d = handle.lint('<x-card></x-card>', {
      rules: { customTagSchema: 'error' },
      customTags: [{ name: 'x-card', schema }],
    });
    const diag = d.find((x) => x.ruleName === 'customTagSchema');
    expect(diag).toBeDefined();
    expect(diag!.message).toBe(
      '<x-card>: validation always-fails failed on /.',
    );
  });
});

describe('per-element envelope exposes text and innerHtml', () => {
  it('rejects empty text content via minLength', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { text: { type: 'string', minLength: 1 } },
    };
    const ok = linter.lint('<pl-note>hi</pl-note>', {
      rules: { customTagSchema: 'error' },
      customTags: [{ name: 'pl-note', schema }],
    });
    expect(ok.filter((d) => d.ruleName === 'customTagSchema')).toEqual([]);

    const bad = linter.lint('<pl-note>   </pl-note>', {
      rules: { customTagSchema: 'error' },
      customTags: [{ name: 'pl-note', schema }],
    });
    expect(bad.some((d) => d.ruleName === 'customTagSchema')).toBe(true);
  });

  it('preserves mustache interpolations verbatim in text', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { text: { type: 'string', pattern: '\\{\\{name\\}\\}' } },
    };
    const ok = linter.lint('<pl-note>Hello {{name}}!</pl-note>', {
      rules: { customTagSchema: 'error' },
      customTags: [{ name: 'pl-note', schema }],
    });
    expect(ok.filter((d) => d.ruleName === 'customTagSchema')).toEqual([]);
  });

  it('strips HTML tags from text but keeps inner content', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { text: { const: 'foo' } },
    };
    const d = linter.lint('<pl-note><b>foo</b></pl-note>', {
      rules: { customTagSchema: 'error' },
      customTags: [{ name: 'pl-note', schema }],
    });
    expect(d.filter((x) => x.ruleName === 'customTagSchema')).toEqual([]);
  });

  it('exposes innerHtml as raw source between open and close tags', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { innerHtml: { const: '<b>foo</b>' } },
    };
    const ok = linter.lint('<pl-note><b>foo</b></pl-note>', {
      rules: { customTagSchema: 'error' },
      customTags: [{ name: 'pl-note', schema }],
    });
    expect(ok.filter((d) => d.ruleName === 'customTagSchema')).toEqual([]);
  });

  it('reports innerHtml as empty for self-closing elements', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { innerHtml: { const: '' }, text: { const: '' } },
    };
    const ok = linter.lint('<pl-icon />', {
      rules: { customTagSchema: 'error' },
      customTags: [{ name: 'pl-icon', schema }],
    });
    expect(ok.filter((d) => d.ruleName === 'customTagSchema')).toEqual([]);
  });

  it('detects duplicate inner text across children via uniqueItems', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        children: {
          type: 'array',
          uniqueItems: true,
          items: { type: 'object', properties: { text: { type: 'string' } } },
        },
      },
    };
    const ok = linter.lint('<pl-list><li>a</li><li>b</li></pl-list>', {
      rules: { customTagSchema: 'error' },
      customTags: [{ name: 'pl-list', schema }],
    });
    expect(ok.filter((d) => d.ruleName === 'customTagSchema')).toEqual([]);

    const bad = linter.lint('<pl-list><li>a</li><li>a</li></pl-list>', {
      rules: { customTagSchema: 'error' },
      customTags: [{ name: 'pl-list', schema }],
    });
    expect(bad.some((d) => d.ruleName === 'customTagSchema')).toBe(true);
  });
});

describe('schema diagnostic merging', () => {
  const BOOLEAN_STRINGS = new Set([
    'true',
    'false',
    'yes',
    'no',
    'on',
    'off',
    '1',
    '0',
  ]);
  const isBooleanString = (v: string) => BOOLEAN_STRINGS.has(v.toLowerCase());

  let handle: Linter;
  beforeAll(async () => {
    handle = await createLinter({
      locateWasm: (name) => {
        if (name === GRAMMAR_WASM_FILENAME) return GRAMMAR_WASM_PATH;
        return path.resolve(REPO_ROOT, 'node_modules', 'web-tree-sitter', name);
      },
      formats: { 'pl-boolean': isBooleanString },
    });
  });

  it('collapses anyOf wrapper + branch errors into one "or" diagnostic', async () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: {
            correct: {
              anyOf: [
                { type: 'boolean' },
                { type: 'string', format: 'pl-boolean' },
              ],
            },
          },
        },
      },
    };
    const d = handle
      .lint('<pl-answer correct="trsue"></pl-answer>', {
        rules: { customTagSchema: 'error' },
        customTags: [{ name: 'pl-answer', schema }],
      })
      .filter((x) => x.ruleName === 'customTagSchema');
    expect(d).toHaveLength(1);
    expect(d[0].message).toBe(
      'Attribute "correct" on <pl-answer> must be boolean or match format "pl-boolean".',
    );
  });

  it('lets a schema-level errorMessage override the merged diagnostic', async () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: {
            correct: {
              anyOf: [
                { type: 'boolean' },
                { type: 'string', format: 'pl-boolean' },
              ],
              errorMessage: 'must be true/false (or yes/no, on/off, 1/0)',
            },
          },
        },
      },
    };
    const d = handle
      .lint('<pl-answer correct="trsue"></pl-answer>', {
        rules: { customTagSchema: 'error' },
        customTags: [{ name: 'pl-answer', schema }],
      })
      .filter((x) => x.ruleName === 'customTagSchema');
    expect(d).toHaveLength(1);
    expect(d[0].message).toBe('must be true/false (or yes/no, on/off, 1/0)');
  });

  it('drops the if-wrapper and keeps the translated then-branch failure', async () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: {
            kind: { enum: ['count', 'free'] },
            max: { type: 'string' },
          },
          if: { properties: { kind: { const: 'count' } } },
          then: { properties: { max: { type: 'integer' } } },
        },
      },
    };
    const d = handle
      .lint('<pl-card kind="count" max="abc"></pl-card>', {
        rules: { customTagSchema: 'error' },
        customTags: [{ name: 'pl-card', schema }],
      })
      .filter((x) => x.ruleName === 'customTagSchema');
    expect(d).toHaveLength(1);
    expect(d[0].message).toBe('Attribute "max" on <pl-card> must be integer.');
  });

  it('translates a plain format failure with attribute context', async () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: {
            answers: { type: 'string', format: 'pl-boolean' },
          },
        },
      },
    };
    const d = handle
      .lint('<pl-card answers="maybe"></pl-card>', {
        rules: { customTagSchema: 'error' },
        customTags: [{ name: 'pl-card', schema }],
      })
      .filter((x) => x.ruleName === 'customTagSchema');
    expect(d).toHaveLength(1);
    expect(d[0].message).toBe(
      'Attribute "answers" on <pl-card> must match format "pl-boolean".',
    );
  });
});

describe('customTagDeprecations rule', () => {
  it('flags a deprecated tag at the start tag with description as reason', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      deprecated: true,
      description: 'Use <pl-question-panel> instead.',
    };
    const d = linter
      .lint('<pl-legacy></pl-legacy>', {
        customTags: [{ name: 'pl-legacy', schema }],
      })
      .filter((x) => x.ruleName === 'customTagDeprecations');
    expect(d).toHaveLength(1);
    expect(d[0].severity).toBe('warning');
    expect(d[0].message).toBe(
      '<pl-legacy> is deprecated. Use <pl-question-panel> instead.',
    );
  });

  it('flags a deprecated attribute and skips a value-level check for it', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: {
            'old-name': {
              deprecated: true,
              description: 'Renamed to "answers-name".',
              oneOf: [{ const: 'a', deprecated: true }, { const: 'b' }],
            },
          },
        },
      },
    };
    const d = linter
      .lint('<pl-card old-name="a"></pl-card>', {
        customTags: [{ name: 'pl-card', schema }],
      })
      .filter((x) => x.ruleName === 'customTagDeprecations');
    expect(d).toHaveLength(1);
    expect(d[0].message).toBe(
      'Attribute "old-name" on <pl-card> is deprecated. Renamed to "answers-name".',
    );
  });

  it('flags a deprecated attribute value via const + deprecated branch', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: {
            kind: {
              oneOf: [
                { const: 'new' },
                {
                  const: 'legacy',
                  deprecated: true,
                  description: 'Use "new".',
                },
              ],
            },
          },
        },
      },
    };
    const ok = linter
      .lint('<pl-card kind="new"></pl-card>', {
        customTags: [{ name: 'pl-card', schema }],
      })
      .filter((x) => x.ruleName === 'customTagDeprecations');
    expect(ok).toEqual([]);

    const bad = linter
      .lint('<pl-card kind="legacy"></pl-card>', {
        customTags: [{ name: 'pl-card', schema }],
      })
      .filter((x) => x.ruleName === 'customTagDeprecations');
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toBe(
      'Value "legacy" for attribute "kind" on <pl-card> is deprecated. Use "new".',
    );
  });

  it('flags a deprecated child-tag combination', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        children: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'object', properties: { tag: { const: 'pl-answer' } } },
              {
                type: 'object',
                properties: { tag: { const: 'pl-answer-old' } },
                deprecated: true,
                description: 'Use <pl-answer>.',
              },
            ],
          },
        },
      },
    };
    const d = linter
      .lint(
        '<pl-choice><pl-answer-old>x</pl-answer-old><pl-answer>y</pl-answer></pl-choice>',
        { customTags: [{ name: 'pl-choice', schema }] },
      )
      .filter((x) => x.ruleName === 'customTagDeprecations');
    expect(d).toHaveLength(1);
    expect(d[0].message).toBe(
      '<pl-answer-old> as a child of <pl-choice> is deprecated. Use <pl-answer>.',
    );
  });

  it('skips value-level deprecation when the value is a mustache interpolation', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: {
            kind: {
              oneOf: [{ const: 'new' }, { const: 'legacy', deprecated: true }],
            },
          },
        },
      },
    };
    const d = linter
      .lint('<pl-card kind="{{value}}"></pl-card>', {
        customTags: [{ name: 'pl-card', schema }],
      })
      .filter((x) => x.ruleName === 'customTagDeprecations');
    expect(d).toEqual([]);
  });

  it('is off by setting `customTagDeprecations: "off"`', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      deprecated: true,
    };
    const d = linter
      .lint('<pl-legacy></pl-legacy>', {
        rules: { customTagDeprecations: 'off' },
        customTags: [{ name: 'pl-legacy', schema }],
      })
      .filter((x) => x.ruleName === 'customTagDeprecations');
    expect(d).toEqual([]);
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
