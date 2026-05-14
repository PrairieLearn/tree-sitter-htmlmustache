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
});

describe('createLinter validators hook', () => {
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

  it('exposes one-level child facades with mustache-section flattening', async () => {
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
            if (element.children[0]?.children.length !== 0) {
              context.report({
                element,
                message: 'children should be one-level',
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
            if (element.hasDynamicAttribute('size')) return;
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
