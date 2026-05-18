/**
 * Smoke tests for the `./linter` entry. Runs in Node via vitest; `locateWasm`
 * returns absolute file paths (which web-tree-sitter's Emscripten loader
 * accepts in Node contexts).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createLinter,
  DEFAULT_CONFIG,
  defineTagValidators,
  type Linter,
} from './index.js';
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

  it('lets a registered format gate draft-06 flat attribute schema diagnostics', async () => {
    const handle = await createLinter({
      locateWasm: (name) => {
        if (name === GRAMMAR_WASM_FILENAME) return GRAMMAR_WASM_PATH;
        return path.resolve(REPO_ROOT, 'node_modules', 'web-tree-sitter', name);
      },
      formats: { 'pl-boolean': isBooleanString },
    });

    const schema = {
      $schema: 'http://json-schema.org/draft-06/schema#',
      type: 'object',
      properties: {
        answers: { type: 'string', format: 'pl-boolean' },
      },
      required: ['answers'],
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

describe('draft-06 flat custom tag schemas', () => {
  it('validates flat attributes without an envelope', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-06/schema#',
      type: 'object',
      properties: { kind: { enum: ['primary', 'secondary'] } },
      required: ['kind'],
      additionalProperties: false,
    };

    const ok = linter.lint('<pl-card kind="primary"></pl-card>', {
      rules: { customTagSchema: 'error' },
      customTags: [{ name: 'pl-card', schema }],
    });
    expect(ok.filter((d) => d.ruleName === 'customTagSchema')).toEqual([]);

    const missing = linter.lint('<pl-card></pl-card>', {
      rules: { customTagSchema: 'error' },
      customTags: [{ name: 'pl-card', schema }],
    });
    expect(missing.find((d) => d.ruleName === 'customTagSchema')!.message).toBe(
      '<pl-card> is missing required attribute "kind".',
    );

    const unknown = linter.lint(
      '<pl-card kind="primary" extra="x"></pl-card>',
      {
        rules: { customTagSchema: 'error' },
        customTags: [{ name: 'pl-card', schema }],
      },
    );
    expect(unknown.find((d) => d.ruleName === 'customTagSchema')!.message).toBe(
      'Unknown attribute "extra" on <pl-card>.',
    );
  });

  it('anchors attribute diagnostics to the offending attribute value or name', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-06/schema#',
      type: 'object',
      properties: { count: { type: 'integer' } },
      additionalProperties: false,
    };
    const d = linter
      .lint('<pl-card count="many"\n  extra="x"></pl-card>', {
        rules: { customTagSchema: 'error' },
        customTags: [{ name: 'pl-card', schema }],
      })
      .filter((x) => x.ruleName === 'customTagSchema');

    const count = d.find((x) => x.message.includes('count'));
    const extra = d.find((x) => x.message.includes('extra'));
    expect(count).toBeDefined();
    expect(count!.line).toBe(1);
    expect(count!.column).toBeGreaterThan(10);
    expect(extra).toBeDefined();
    expect(extra!.line).toBe(2);
    expect(extra!.column).toBe(3);
  });

  it('allows boolean custom tag attributes by default and rejects them when defaults opt out', () => {
    const allowed = linter
      .lint('<pl-answer correct></pl-answer>', {
        rules: { customTagSchema: 'error' },
        customTags: [{ name: 'pl-answer' }],
      })
      .filter((x) => x.ruleName === 'customTagSchema');
    expect(allowed).toEqual([]);

    const rejected = linter
      .lint('<pl-answer correct></pl-answer>', {
        rules: { customTagSchema: 'error' },
        customTagDefaults: { allowBooleanAttributes: false },
        customTags: [{ name: 'pl-answer' }],
      })
      .filter((x) => x.ruleName === 'customTagSchema');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].message).toBe(
      'Attribute "correct" on <pl-answer> must have a value.',
    );
  });

  it('lets top-level tag options override boolean attribute defaults', () => {
    const optedIn = linter
      .lint('<pl-answer correct></pl-answer>', {
        rules: { customTagSchema: 'error' },
        customTagDefaults: { allowBooleanAttributes: false },
        customTags: [{ name: 'pl-answer', allowBooleanAttributes: true }],
      })
      .filter((x) => x.ruleName === 'customTagSchema');
    expect(optedIn).toEqual([]);

    const optedOut = linter
      .lint('<pl-answer correct></pl-answer>', {
        rules: { customTagSchema: 'error' },
        customTags: [{ name: 'pl-answer', allowBooleanAttributes: false }],
      })
      .filter((x) => x.ruleName === 'customTagSchema');
    expect(optedOut).toHaveLength(1);
    expect(optedOut[0].message).toBe(
      'Attribute "correct" on <pl-answer> must have a value.',
    );
  });

  it('applies child-specific boolean attribute options in parent-owned contexts', () => {
    const d = linter
      .lint(
        '<pl-multiple-choice><pl-answer correct></pl-answer></pl-multiple-choice><pl-question><pl-answer correct></pl-answer></pl-question>',
        {
          rules: {
            customTagSchema: 'error',
            unrecognizedHtmlTags: 'off',
          },
          customTags: [
            {
              name: 'pl-multiple-choice',
              children: [{ name: 'pl-answer', allowBooleanAttributes: false }],
            },
            {
              name: 'pl-question',
              children: [{ name: 'pl-answer', allowBooleanAttributes: true }],
            },
          ],
        },
      )
      .filter((x) => x.ruleName === 'customTagSchema');

    expect(d).toHaveLength(1);
    expect(d[0].message).toBe(
      'Attribute "correct" on <pl-answer> inside <pl-multiple-choice> must have a value.',
    );
  });

  it('does not reject valued boolean-like attributes when boolean attributes are disabled', () => {
    const d = linter
      .lint(
        '<pl-answer correct="true"></pl-answer><pl-answer correct="{{value}}"></pl-answer>',
        {
          rules: { customTagSchema: 'error' },
          customTagDefaults: { allowBooleanAttributes: false },
          customTags: [{ name: 'pl-answer' }],
        },
      )
      .filter((x) => x.ruleName === 'customTagSchema');

    expect(d).toEqual([]);
  });

  it('anchors boolean attribute diagnostics to the offending attribute', () => {
    const d = linter
      .lint('<pl-answer\n  correct></pl-answer>', {
        rules: { customTagSchema: 'error' },
        customTagDefaults: { allowBooleanAttributes: false },
        customTags: [{ name: 'pl-answer' }],
      })
      .filter((x) => x.ruleName === 'customTagSchema');

    expect(d).toHaveLength(1);
    expect(d[0].message).toBe(
      'Attribute "correct" on <pl-answer> must have a value.',
    );
    expect(d[0].line).toBe(2);
    expect(d[0].column).toBe(3);
  });

  it('waives dynamic mustache attributes but keeps literal sibling failures', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-06/schema#',
      type: 'object',
      properties: {
        variant: { enum: ['primary', 'secondary'] },
        count: { type: 'number' },
      },
      additionalProperties: false,
    };
    const d = linter
      .lint(
        '<pl-card variant="{{variant}}" count="many" mystery="x"></pl-card>',
        {
          rules: { customTagSchema: 'error' },
          customTags: [{ name: 'pl-card', schema }],
        },
      )
      .filter((x) => x.ruleName === 'customTagSchema');

    expect(d.some((x) => x.message.includes('variant'))).toBe(false);
    expect(d.some((x) => x.message.includes('count'))).toBe(true);
    expect(d.some((x) => x.message.includes('mystery'))).toBe(true);
  });

  it('merges anyOf branch failures for flat attribute schemas', async () => {
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
    const handle = await createLinter({
      locateWasm: (name) => {
        if (name === GRAMMAR_WASM_FILENAME) return GRAMMAR_WASM_PATH;
        return path.resolve(REPO_ROOT, 'node_modules', 'web-tree-sitter', name);
      },
      formats: {
        'pl-boolean': (v: string) => BOOLEAN_STRINGS.has(v.toLowerCase()),
      },
    });
    const schema = {
      $schema: 'http://json-schema.org/draft-06/schema#',
      type: 'object',
      properties: {
        correct: {
          anyOf: [
            { type: 'boolean' },
            { type: 'string', format: 'pl-boolean' },
          ],
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

  it('defaults child validation to strict and treats mustache sections as transparent', () => {
    const d = linter
      .lint(
        '<pl-multiple-choice>{{#cond}}<pl-feedback></pl-feedback>{{/cond}}</pl-multiple-choice>',
        {
          rules: {
            customTagSchema: 'error',
            unrecognizedHtmlTags: 'off',
          },
          customTags: [
            {
              name: 'pl-multiple-choice',
              children: [{ name: 'pl-answer' }],
            },
            { name: 'pl-answer' },
            { name: 'pl-feedback' },
          ],
        },
      )
      .filter((x) => x.ruleName === 'customTagSchema');

    expect(d).toHaveLength(1);
    expect(d[0].message).toBe(
      '<pl-multiple-choice> only allows these child elements: <pl-answer>.',
    );
  });

  it('allows unlisted children in loose mode while validating listed children', () => {
    const answerSchema = {
      $schema: 'http://json-schema.org/draft-06/schema#',
      type: 'object',
      properties: { correct: { type: 'boolean' } },
      additionalProperties: false,
    };

    const d = linter
      .lint(
        '<pl-multiple-choice><pl-answer ranking="1"></pl-answer><pl-feedback></pl-feedback></pl-multiple-choice>',
        {
          rules: {
            customTagSchema: 'error',
            unrecognizedHtmlTags: 'off',
          },
          customTags: [
            {
              name: 'pl-multiple-choice',
              allowAdditionalChildren: true,
              children: [{ name: 'pl-answer', schema: answerSchema }],
            },
            { name: 'pl-answer' },
            { name: 'pl-feedback' },
          ],
        },
      )
      .filter((x) => x.ruleName === 'customTagSchema');

    expect(d).toHaveLength(1);
    expect(d[0].message).toBe(
      'Unknown attribute "ranking" on <pl-answer> inside <pl-multiple-choice>.',
    );
  });

  it('uses a parent-specific child schema without making the child schema global', () => {
    const answerSchema = {
      $schema: 'http://json-schema.org/draft-06/schema#',
      type: 'object',
      properties: { correct: { type: 'boolean' } },
      additionalProperties: false,
    };

    const d = linter
      .lint(
        '<pl-answer ranking="1"></pl-answer><pl-multiple-choice><pl-answer ranking="1"></pl-answer></pl-multiple-choice>',
        {
          rules: {
            customTagSchema: 'error',
            unrecognizedHtmlTags: 'off',
          },
          customTags: [
            {
              name: 'pl-multiple-choice',
              children: [{ name: 'pl-answer', schema: answerSchema }],
            },
            { name: 'pl-answer' },
          ],
        },
      )
      .filter((x) => x.ruleName === 'customTagSchema');

    expect(d).toHaveLength(1);
    expect(d[0].message).toBe(
      'Unknown attribute "ranking" on <pl-answer> inside <pl-multiple-choice>.',
    );
  });

  it('restricts child-only tags to the parents that declare them', () => {
    const inside = linter.lint(
      '<pl-multiple-choice><pl-answer></pl-answer></pl-multiple-choice>',
      {
        rules: {
          customTagSchema: 'error',
          unrecognizedHtmlTags: 'error',
        },
        customTags: [
          {
            name: 'pl-multiple-choice',
            children: [{ name: 'pl-answer' }],
          },
        ],
      },
    );
    expect(inside.filter((x) => x.ruleName === 'customTagSchema')).toEqual([]);
    expect(inside.filter((x) => x.ruleName === 'unrecognizedHtmlTags')).toEqual(
      [],
    );

    const outside = linter
      .lint('<pl-answer></pl-answer>', {
        rules: {
          customTagSchema: 'error',
          unrecognizedHtmlTags: 'error',
        },
        customTags: [
          {
            name: 'pl-multiple-choice',
            children: [{ name: 'pl-answer' }],
          },
        ],
      })
      .filter((x) => x.ruleName === 'customTagSchema');

    expect(outside).toHaveLength(1);
    expect(outside[0].message).toBe(
      '<pl-answer> may only appear as a direct child of these parent elements: <pl-multiple-choice>.',
    );
  });

  it('supports recursive child-only rules without promoting nested children globally', () => {
    const customTags = [
      {
        name: 'pl-multiple-choice',
        children: [
          {
            name: 'pl-answer',
            children: [{ name: 'pl-answer-feedback' }],
          },
        ],
      },
    ];

    const valid = linter.lint(
      '<pl-multiple-choice><pl-answer>{{#ok}}<pl-answer-feedback></pl-answer-feedback>{{/ok}}</pl-answer></pl-multiple-choice>',
      {
        rules: {
          customTagSchema: 'error',
          unrecognizedHtmlTags: 'error',
        },
        customTags,
      },
    );
    expect(valid.filter((x) => x.ruleName === 'customTagSchema')).toEqual([]);
    expect(valid.filter((x) => x.ruleName === 'unrecognizedHtmlTags')).toEqual(
      [],
    );

    const wrongChild = linter
      .lint(
        '<pl-multiple-choice><pl-answer><span></span></pl-answer></pl-multiple-choice>',
        {
          rules: {
            customTagSchema: 'error',
            unrecognizedHtmlTags: 'error',
          },
          customTags,
        },
      )
      .filter((x) => x.ruleName === 'customTagSchema');
    expect(wrongChild).toHaveLength(1);
    expect(wrongChild[0].message).toBe(
      '<pl-answer> only allows these child elements: <pl-answer-feedback>.',
    );

    const orphanNestedChild = linter
      .lint('<pl-answer-feedback></pl-answer-feedback>', {
        rules: {
          customTagSchema: 'error',
          unrecognizedHtmlTags: 'error',
        },
        customTags,
      })
      .filter((x) => x.ruleName === 'customTagSchema');
    expect(orphanNestedChild).toHaveLength(1);
    expect(orphanNestedChild[0].message).toBe(
      '<pl-answer-feedback> may only appear as a direct child of these parent elements: <pl-answer>.',
    );
  });

  it('supports self-references for child-only recursive tags', () => {
    const customTags = [
      {
        name: 'pl-tree',
        children: [
          {
            name: 'pl-node',
            children: [{ name: 'pl-node' }],
          },
        ],
      },
    ];

    const valid = linter
      .lint(
        '<pl-tree><pl-node><pl-node><pl-node></pl-node></pl-node></pl-node></pl-tree>',
        {
          rules: {
            customTagSchema: 'error',
            unrecognizedHtmlTags: 'error',
          },
          customTags,
        },
      )
      .filter((x) => x.ruleName === 'customTagSchema');
    expect(valid).toEqual([]);

    const invalid = linter
      .lint(
        '<pl-tree><pl-node><pl-node><span></span></pl-node></pl-node></pl-tree>',
        {
          rules: {
            customTagSchema: 'error',
            unrecognizedHtmlTags: 'off',
          },
          customTags,
        },
      )
      .filter((x) => x.ruleName === 'customTagSchema');
    expect(invalid).toHaveLength(1);
    expect(invalid[0].message).toBe(
      '<pl-node> only allows these child elements: <pl-node>.',
    );
  });

  it('uses top-level child rules when a scoped child tag is also globally allowed', () => {
    const d = linter
      .lint('<pl-answer><span></span></pl-answer>', {
        rules: {
          customTagSchema: 'error',
          unrecognizedHtmlTags: 'off',
        },
        customTags: [
          {
            name: 'pl-multiple-choice',
            children: [{ name: 'pl-answer' }],
          },
          {
            name: 'pl-answer',
            children: [{ name: 'pl-answer-feedback' }],
          },
        ],
      })
      .filter((x) => x.ruleName === 'customTagSchema');

    expect(d).toHaveLength(1);
    expect(d[0].message).toBe(
      '<pl-answer> only allows these child elements: <pl-answer-feedback>.',
    );
  });

  it('allows the same child tag to use different schemas under different parents', () => {
    const choiceAnswerSchema = {
      $schema: 'http://json-schema.org/draft-06/schema#',
      type: 'object',
      properties: { correct: { type: 'boolean' } },
      additionalProperties: false,
    };
    const orderingAnswerSchema = {
      $schema: 'http://json-schema.org/draft-06/schema#',
      type: 'object',
      properties: { ranking: { type: 'integer' } },
      additionalProperties: false,
    };

    const d = linter
      .lint(
        '<pl-multiple-choice><pl-answer ranking="1"></pl-answer></pl-multiple-choice><pl-order-blocks><pl-answer correct></pl-answer></pl-order-blocks>',
        {
          rules: {
            customTagSchema: 'error',
            unrecognizedHtmlTags: 'off',
          },
          customTags: [
            {
              name: 'pl-multiple-choice',
              children: [{ name: 'pl-answer', schema: choiceAnswerSchema }],
            },
            {
              name: 'pl-order-blocks',
              children: [{ name: 'pl-answer', schema: orderingAnswerSchema }],
            },
            { name: 'pl-answer' },
          ],
        },
      )
      .filter((x) => x.ruleName === 'customTagSchema');

    expect(d.map((x) => x.message)).toEqual([
      'Unknown attribute "ranking" on <pl-answer> inside <pl-multiple-choice>.',
      'Unknown attribute "correct" on <pl-answer> inside <pl-order-blocks>.',
    ]);
  });
});

describe('createLinter validators hook', () => {
  it('defineTagValidators expands independent tag-scoped rules', async () => {
    const handle = await createLinter({
      locateWasm: GRAMMAR_WASM_PATH,
      validators: defineTagValidators('PL-MULTIPLE-CHOICE', {
        'child-tags'(element, context) {
          for (const child of element.childrenWithoutTag('pl-answer')) {
            context.reportElement(
              child,
              'pl-multiple-choice only allows pl-answer children',
            );
          }
        },
        'requires-answer': {
          severity: 'warning',
          validate(element, context) {
            if (
              !element.hasAttribute('external-json') &&
              element.childrenWithTag('pl-answer').length === 0
            ) {
              context.reportElement(element, 'Missing answer choice');
            }
          },
        },
      }),
    });
    const d = handle.lint(
      '<pl-multiple-choice><span></span></pl-multiple-choice>',
      {
        customTags: [{ name: 'pl-multiple-choice' }, { name: 'pl-answer' }],
      },
    );

    expect(d.find((x) => x.ruleName === 'child-tags')?.severity).toBe('error');
    expect(d.find((x) => x.ruleName === 'requires-answer')?.severity).toBe(
      'warning',
    );
  });

  it('exposes dynamic-safe attribute helpers and reporter helpers', async () => {
    const handle = await createLinter({
      locateWasm: GRAMMAR_WASM_PATH,
      validators: defineTagValidators('pl-card', {
        'attribute-helpers'(element, context) {
          if (!element.hasAttribute('SIZE')) {
            context.reportElement(element, 'Missing size');
          }
          if (element.getAttribute('size') !== '{{n}}') {
            context.reportElement(element, 'Raw size mismatch');
          }
          if (element.getLiteralAttribute('size') !== undefined) {
            context.reportElement(element, 'Dynamic size looked literal');
          }
          if (element.getLiteralAttribute('kind') !== 'allowed') {
            context.reportAttribute(element, 'kind', 'Invalid kind');
          }
        },
      }),
    });

    const clean = handle.lint(
      '<pl-card size="{{n}}" kind="allowed"></pl-card>',
      {
        customTags: [{ name: 'pl-card' }],
      },
    );
    expect(clean.filter((x) => x.ruleName === 'attribute-helpers')).toEqual([]);

    const invalid = handle.lint(
      '<pl-card\n  size="{{n}}"\n  kind="bad"></pl-card>',
      {
        customTags: [{ name: 'pl-card' }],
      },
    );
    const diag = invalid.find((x) => x.ruleName === 'attribute-helpers');
    expect(diag).toBeDefined();
    expect(diag!.message).toBe('Invalid kind');
    expect(diag!.line).toBe(3);
    expect(diag!.column).toBe(3);
  });

  it('runs validators for matching declared custom tags only', async () => {
    const handle = await createLinter({
      locateWasm: GRAMMAR_WASM_PATH,
      validators: [
        {
          id: 'pl-card-kind',
          tags: ['pl-card'],
          validate(element, context) {
            if (element.attributes.kind !== 'allowed') {
              context.report({
                element,
                attribute: 'kind',
                message: 'Invalid card kind',
              });
            }
          },
        },
      ],
    });
    const d = handle.lint(
      '<pl-card kind="bad"></pl-card><x-card kind="bad"></x-card>',
      {
        customTags: [{ name: 'pl-card' }, { name: 'x-card' }],
      },
    );
    expect(d.filter((x) => x.ruleName === 'pl-card-kind')).toHaveLength(1);
  });

  it('runs multiple validators on one tag', async () => {
    const handle = await createLinter({
      locateWasm: GRAMMAR_WASM_PATH,
      validators: [
        {
          id: 'needs-kind',
          tags: ['pl-card'],
          validate(element, context) {
            if (!('kind' in element.attributes)) {
              context.report({ element, message: 'Missing kind' });
            }
          },
        },
        {
          id: 'needs-label',
          tags: ['pl-card'],
          validate(element, context) {
            if (!('label' in element.attributes)) {
              context.report({ element, message: 'Missing label' });
            }
          },
        },
      ],
    });
    const d = handle.lint('<pl-card></pl-card>', {
      customTags: [{ name: 'pl-card' }],
    });
    expect(d.map((x) => x.ruleName)).toEqual(
      expect.arrayContaining(['needs-kind', 'needs-label']),
    );
  });

  it('runs one validator for multiple tags', async () => {
    const handle = await createLinter({
      locateWasm: GRAMMAR_WASM_PATH,
      validators: [
        {
          id: 'needs-name',
          tags: ['pl-card', 'pl-panel'],
          validate(element, context) {
            if (!('name' in element.attributes)) {
              context.report({
                element,
                message: `Missing name on ${element.tag}`,
              });
            }
          },
        },
      ],
    });
    const d = handle.lint('<pl-card></pl-card><pl-panel></pl-panel>', {
      customTags: [{ name: 'pl-card' }, { name: 'pl-panel' }],
    });
    expect(d.filter((x) => x.ruleName === 'needs-name')).toHaveLength(2);
  });

  it('honors severity overrides via rules and inline disable', async () => {
    const handle = await createLinter({
      locateWasm: GRAMMAR_WASM_PATH,
      validators: [
        {
          id: 'no-pl-card',
          tags: ['pl-card'],
          severity: 'error',
          validate(element, context) {
            context.report({ element, message: 'No card' });
          },
        },
      ],
    });
    const warning = handle.lint('<pl-card></pl-card>', {
      rules: { 'no-pl-card': 'warning' },
      customTags: [{ name: 'pl-card' }],
    });
    expect(warning.find((x) => x.ruleName === 'no-pl-card')!.severity).toBe(
      'warning',
    );

    const disabled = handle.lint(
      '{{! htmlmustache-disable no-pl-card }}\n<pl-card></pl-card>',
      {
        rules: { 'no-pl-card': 'warning' },
        customTags: [{ name: 'pl-card' }],
      },
    );
    expect(disabled.some((x) => x.ruleName === 'no-pl-card')).toBe(false);
  });

  it('exposes direct child facades with mustache-section flattening', async () => {
    const handle = await createLinter({
      locateWasm: GRAMMAR_WASM_PATH,
      validators: [
        {
          id: 'child-tags',
          tags: ['pl-list'],
          validate(element, context) {
            const tags = element.children.map((child) => child.tag).join(',');
            if (tags !== 'pl-item,pl-extra') {
              context.report({ element, message: `children:${tags}` });
            }
            if (
              element.children[0]?.childrenWithTag('span').length !== 1 ||
              element.children[0]?.childrenWithTag('pl-extra').length !== 0
            ) {
              context.report({
                element,
                message: 'child facade children mismatch',
              });
            }
          },
        },
      ],
    });
    const d = handle.lint(
      '<pl-list>{{#items}}<pl-item><span></span></pl-item>{{/items}}<pl-extra></pl-extra></pl-list>',
      {
        customTags: [
          { name: 'pl-list' },
          { name: 'pl-item' },
          { name: 'pl-extra' },
        ],
      },
    );
    expect(d.filter((x) => x.ruleName === 'child-tags')).toEqual([]);
  });

  it('populates nested custom-tag child facades recursively', async () => {
    const handle = await createLinter({
      locateWasm: GRAMMAR_WASM_PATH,
      validators: defineTagValidators('pl-order-blocks', {
        'requires-group-answer'(element, context) {
          for (const group of element.childrenWithTag('pl-block-group')) {
            const answers = group.childrenWithTag('pl-answer');
            if (answers.length === 0) {
              context.reportElement(group, 'Group has no answers');
            }
          }
        },
      }),
    });
    const d = handle.lint(
      '<pl-order-blocks><pl-block-group><pl-answer>One</pl-answer></pl-block-group></pl-order-blocks>',
      {
        customTags: [
          { name: 'pl-order-blocks' },
          { name: 'pl-block-group' },
          { name: 'pl-answer' },
        ],
      },
    );
    expect(d.filter((x) => x.ruleName === 'requires-group-answer')).toEqual(
      [],
    );
  });

  it('exposes innerHtml only when includeInnerHtml is set', async () => {
    const handle = await createLinter({
      locateWasm: GRAMMAR_WASM_PATH,
      validators: [
        {
          id: 'needs-inner-html',
          tags: ['pl-card'],
          options: { includeInnerHtml: true },
          validate(element, context) {
            if (element.innerHtml !== '<b>Hi</b>') {
              context.report({
                element,
                message: `inner:${element.innerHtml ?? 'missing'}`,
              });
            }
          },
        },
      ],
    });
    const d = handle.lint('<pl-card><b>Hi</b></pl-card>', {
      customTags: [{ name: 'pl-card' }],
    });
    expect(d.filter((x) => x.ruleName === 'needs-inner-html')).toEqual([]);
  });

  it('anchors attribute reports and exposes dynamic attribute checks', async () => {
    const handle = await createLinter({
      locateWasm: GRAMMAR_WASM_PATH,
      validators: [
        {
          id: 'literal-size',
          tags: ['pl-card'],
          validate(element, context) {
            if (element.isAttributeDynamic('size')) return;
            context.report({
              element,
              attribute: 'size',
              message: 'Size must be dynamic',
            });
          },
        },
      ],
    });
    const d = handle.lint(
      '<pl-card\n  size="4"></pl-card><pl-card size="{{n}}"></pl-card>',
      {
        customTags: [{ name: 'pl-card' }],
      },
    );
    const diag = d.find((x) => x.ruleName === 'literal-size');
    expect(diag).toBeDefined();
    expect(diag!.line).toBe(2);
    expect(diag!.column).toBe(3);
  });

  it('turns validator exceptions into diagnostics', async () => {
    const handle = await createLinter({
      locateWasm: GRAMMAR_WASM_PATH,
      validators: [
        {
          id: 'throws-validator',
          tags: ['pl-card'],
          validate() {
            throw new Error('boom');
          },
        },
      ],
    });
    const d = handle.lint('<pl-card></pl-card>', {
      customTags: [{ name: 'pl-card' }],
    });
    const diag = d.find((x) => x.ruleName === 'throws-validator');
    expect(diag).toBeDefined();
    expect(diag!.message).toBe('Validator "throws-validator" failed: boom');
    expect(diag!.severity).toBe('error');
  });
});

describe('customTagDeprecations rule', () => {
  it('flags a deprecated tag at the start tag with description as reason', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-06/schema#',
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
      $schema: 'http://json-schema.org/draft-06/schema#',
      type: 'object',
      properties: {
        'old-name': {
          deprecated: true,
          description: 'Renamed to "answers-name".',
          oneOf: [{ const: 'a', deprecated: true }, { const: 'b' }],
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
      $schema: 'http://json-schema.org/draft-06/schema#',
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

  it('skips value-level deprecation when the value is a mustache interpolation', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-06/schema#',
      type: 'object',
      properties: {
        kind: {
          oneOf: [{ const: 'new' }, { const: 'legacy', deprecated: true }],
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
      $schema: 'http://json-schema.org/draft-06/schema#',
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
