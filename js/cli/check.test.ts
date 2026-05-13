import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  collectErrors,
  formatError,
  formatSummary,
  resolveFiles,
  applyFixes,
} from './check';
import { initializeParser, parseDocument } from './wasm';
import { loadSchemaRegistry } from '../shared/customTagSchemaLoader.js';

beforeAll(async () => {
  await initializeParser();
});

function parse(source: string) {
  return parseDocument(source);
}

const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

function schemaRegistryFor(name: string, schema: Record<string, unknown>) {
  const { registry, loadErrors } = loadSchemaRegistry([{ name, schema }]);
  expect(loadErrors).toEqual([]);
  return registry;
}

const PL_MULTIPLE_CHOICE_SCHEMA = {
  $schema: DRAFT_2020_12,
  type: 'object',
  properties: {
    tag: { const: 'pl-multiple-choice' },
    attributes: {
      type: 'object',
      htmlGlobalAttributes: true,
      properties: {
        'answers-name': { type: 'string' },
        'builtin-grading': { type: 'boolean' },
        display: { enum: ['block', 'inline', 'dropdown'] },
        'fixed-order': { type: 'boolean' },
        'hide-score-badge': { type: 'boolean' },
        inline: { type: 'boolean' },
        order: { enum: ['random', 'ascend', 'descend', 'fixed'] },
        placeholder: { type: 'string' },
        size: { type: 'integer', minimum: 1 },
        weight: { type: 'number' },
      },
      required: ['answers-name'],
      additionalProperties: false,
      allOf: [
        { not: { required: ['inline', 'display'] } },
        { not: { required: ['fixed-order', 'order'] } },
        {
          if: { required: ['size'] },
          then: {
            properties: { display: { const: 'dropdown' } },
            required: ['display'],
          },
        },
        {
          if: { required: ['placeholder'] },
          then: {
            properties: { display: { const: 'dropdown' } },
            required: ['display'],
          },
        },
      ],
    },
    children: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tag: { const: 'pl-answer' },
          attributes: {
            type: 'object',
            properties: {
              correct: { type: 'boolean' },
              feedback: { type: 'string' },
              score: { type: 'number' },
            },
            required: ['correct', 'feedback', 'score'],
            additionalProperties: false,
          },
        },
        required: ['tag', 'attributes'],
      },
    },
  },
  allOf: [
    {
      if: {
        properties: {
          attributes: {
            properties: {
              'builtin-grading': { type: 'boolean', const: false },
            },
            required: ['builtin-grading'],
          },
        },
      },
      then: {
        properties: {
          attributes: {
            not: {
              anyOf: [
                { required: ['weight'] },
                { required: ['hide-score-badge'] },
              ],
            },
          },
          children: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                attributes: {
                  type: 'object',
                  not: {
                    anyOf: [
                      { required: ['score'] },
                      { required: ['feedback'] },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
  ],
} satisfies Record<string, unknown>;

describe('collectErrors', () => {
  it('returns no errors for a clean file', () => {
    const tree = parse('<div><p>Hello {{name}}</p></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors).toEqual([]);
  });

  it('detects ERROR nodes from malformed HTML', () => {
    const tree = parse('<div><//invalid></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message === 'Syntax error')).toBe(true);
  });

  it('detects mismatched mustache section', () => {
    const tree = parse('{{#foo}}<p>hello</p>{{/bar}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((e) => e.message === 'Mismatched mustache section: {{/bar}}'),
    ).toBe(true);
  });

  it('detects mismatched inverted section', () => {
    const tree = parse('{{^foo}}<p>hello</p>{{/bar}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((e) => e.message === 'Mismatched mustache section: {{/bar}}'),
    ).toBe(true);
  });

  it('detects erroneous HTML end tag', () => {
    const tree = parse('<div></span></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((e) => e.message === 'Mismatched HTML end tag: </span>'),
    ).toBe(true);
  });

  it('detects orphan erroneous end tags inside mustache sections', () => {
    const tree = parse('{{#inline}}</span>{{/inline}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('detects orphan erroneous end tags inside inverted mustache sections', () => {
    const tree = parse('{{^inline}}</span>{{/inline}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('still detects erroneous end tags outside mustache sections', () => {
    const tree = parse('<div></span></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((e) => e.message === 'Mismatched HTML end tag: </span>'),
    ).toBe(true);
  });

  it('detects missing nodes', () => {
    const tree = parse('<div');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.startsWith('Missing'))).toBe(true);
  });

  it('detects multiple errors in one file', () => {
    const tree = parse('<div></span>\n{{#foo}}{{/bar}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('includes correct location info', () => {
    const source = '<div>\n  <p>\n  {{/wrong}}\n</div>';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    const sectionError = errors.find((e) => e.message.includes('{{/wrong}}'));
    if (sectionError) {
      expect(sectionError.line).toBe(3);
      expect(sectionError.file).toBe('test.mustache');
    }
  });
});

describe('HTML balance checker', () => {
  it('allows same-name section open/close pairs (only warning for consecutive)', () => {
    const tree = parse('{{#s}}<div>{{/s}} {{#s}}</div>{{/s}}');
    const errors = collectErrors(tree, 'test.mustache');
    // The only error should be the consecutive section warning
    expect(errors.every((e) => e.severity === 'warning')).toBe(true);
  });

  it('detects inverted section open/close mismatch with path info', () => {
    const tree = parse('{{#s}}<div>{{/s}} {{^s}}</div>{{/s}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    // Errors should include the failing condition
    expect(errors.some((e) => e.message.includes('when s is'))).toBe(true);
  });

  it('allows if/else balanced patterns', () => {
    const tree = parse(
      '{{#s}}<span>{{/s}}{{^s}}<div>{{/s}} {{#s}}</span>{{/s}}{{^s}}</div>{{/s}}',
    );
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors).toEqual([]);
  });

  it('detects if/else swapped close tags with path info', () => {
    const tree = parse(
      '{{#s}}<span>{{/s}}{{^s}}<div>{{/s}} {{#s}}</div>{{/s}}{{^s}}</span>{{/s}}',
    );
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.includes('when s is'))).toBe(true);
  });

  it('detects standalone orphan close in section with path info', () => {
    const tree = parse('{{#s}}</span>{{/s}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.includes('when s is truthy'))).toBe(
      true,
    );
  });

  it('reports no path info for unconditional mismatches', () => {
    const tree = parse('<div></span></div>');
    const errors = collectErrors(tree, 'test.mustache');
    const mismatch = errors.find((e) => e.message.includes('</span>'));
    expect(mismatch).toBeDefined();
    expect(mismatch!.message).toBe('Mismatched HTML end tag: </span>');
    expect(mismatch!.message).not.toContain('when');
  });

  it('detects mismatch in nested conditional with else fallback', () => {
    // if start: <div>, else: <span>
    // if baz: (if start: </div>, else: </span>), else: </span>
    //
    // start=T baz=T → [OPEN(div), CLOSE(div)] balanced
    // start=F baz=T → [OPEN(span), CLOSE(span)] balanced
    // start=F baz=F → [OPEN(span), CLOSE(span)] balanced
    // start=T baz=F → [OPEN(div), CLOSE(span)] MISMATCH
    const source = [
      '{{#start}}<div>{{/start}}',
      '{{^start}}<span>{{/start}}',
      '{{#baz}}',
      '  {{#start}}</div>{{/start}}',
      '  {{^start}}</span>{{/start}}',
      '{{/baz}}',
      '{{^baz}}',
      '  </span>',
      '{{/baz}}',
    ].join('\n');
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    const mismatch = errors.find((e) =>
      e.message.includes('Mismatched HTML end tag'),
    );
    expect(mismatch).toBeDefined();
    expect(mismatch!.message).toContain('</span>');
    expect(mismatch!.message).toContain('start is truthy');
    expect(mismatch!.message).toContain('baz is falsy');
  });

  it('detects nested same-section even with balanced inner tags', () => {
    const tree = parse(
      '{{#items}}<div>{{#items}}<span></span>{{/items}}</div>{{/items}}',
    );
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message.includes('Nested duplicate section')),
    ).toBe(true);
  });

  it('detects if/else open with same-type close (button/span bug)', () => {
    // {{#s}} opens <button>, {{^s}} opens <span>
    // but both closing tags are in {{#s}} — the second should be {{^s}}
    const source = [
      '{{#s}}<button><i></i>{{/s}}',
      '{{^s}}<span>{{/s}}',
      'text',
      '{{#s}}</button>{{/s}}',
      '{{#s}}</span>{{/s}}',
    ].join('\n');
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    // Should detect errors — </span> mismatched on truthy path, <span> unclosed on falsy path
    const nonWarnings = errors.filter((e) => e.severity !== 'warning');
    expect(nonWarnings.length).toBeGreaterThan(0);
    // Balance checker should include path condition info
    expect(nonWarnings.some((e) => e.message.includes('when s is'))).toBe(true);
  });

  it('detects consecutive sections in button/span pattern', () => {
    // Isolated test: two consecutive {{#s}} sections with whitespace gap
    const source = '{{#s}}</button>{{/s}}\n{{#s}}</span>{{/s}}';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some(
        (e) =>
          e.message.includes('Consecutive duplicate section') &&
          e.severity === 'warning',
      ),
    ).toBe(true);
  });
});

describe('Unclosed tag detection', () => {
  it('detects unclosed canvas tag', () => {
    const tree = parse('<div><canvas></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message === 'Unclosed HTML tag: <canvas>'),
    ).toBe(true);
  });

  it('allows properly closed canvas tag', () => {
    const tree = parse('<div><canvas></canvas></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors).toEqual([]);
  });

  it('allows void elements without close tags', () => {
    const tree = parse('<div><br><hr><img src="x"><input type="text"></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors).toEqual([]);
  });

  it('allows optional end tag elements', () => {
    const tree = parse('<ul><li>one<li>two</ul>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors).toEqual([]);
  });

  it('allows p implicitly closed by block element', () => {
    const tree = parse('<p>text<div>block</div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors).toEqual([]);
  });

  it('detects unclosed span inside div', () => {
    const tree = parse('<div><span>text</div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some((e) => e.message === 'Unclosed HTML tag: <span>')).toBe(
      true,
    );
  });

  it('detects unclosed div at end of document', () => {
    const tree = parse('<div>content');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some((e) => e.message === 'Unclosed HTML tag: <div>')).toBe(
      true,
    );
  });
});

describe('Mustache lint checks', () => {
  describe('nested same-name sections', () => {
    it('detects nested duplicate section', () => {
      const tree = parse('{{#x}}{{#x}}inner{{/x}}{{/x}}');
      const errors = collectErrors(tree, 'test.mustache');
      expect(
        errors.some(
          (e) =>
            e.message.includes('Nested duplicate section') &&
            e.message.includes('{{#x}}'),
        ),
      ).toBe(true);
    });

    it('allows non-nested same-name sections (sequential)', () => {
      const tree = parse('{{#x}}first{{/x}}{{#x}}second{{/x}}');
      const errors = collectErrors(tree, 'test.mustache');
      expect(
        errors.some((e) => e.message.includes('Nested duplicate section')),
      ).toBe(false);
    });

    it('detects deeply nested duplicate', () => {
      const tree = parse('{{#a}}{{#b}}{{#a}}deep{{/a}}{{/b}}{{/a}}');
      const errors = collectErrors(tree, 'test.mustache');
      expect(
        errors.some(
          (e) =>
            e.message.includes('Nested duplicate section') &&
            e.message.includes('{{#a}}'),
        ),
      ).toBe(true);
    });

    it('allows different-name nested sections', () => {
      const tree = parse('{{#a}}{{#b}}inner{{/b}}{{/a}}');
      const errors = collectErrors(tree, 'test.mustache');
      expect(
        errors.some((e) => e.message.includes('Nested duplicate section')),
      ).toBe(false);
    });
  });

  describe('unquoted mustache attribute value', () => {
    it('detects unquoted mustache in attribute', () => {
      const tree = parse('<div class={{foo}}></div>');
      const errors = collectErrors(tree, 'test.mustache');
      expect(
        errors.some((e) =>
          e.message.includes('Unquoted mustache attribute value'),
        ),
      ).toBe(true);
    });

    it('allows quoted mustache in attribute', () => {
      const tree = parse('<div class="{{foo}}"></div>');
      const errors = collectErrors(tree, 'test.mustache');
      expect(
        errors.some((e) =>
          e.message.includes('Unquoted mustache attribute value'),
        ),
      ).toBe(false);
    });

    it('does not flag standalone mustache in tag', () => {
      const tree = parse('<div {{attrs}}></div>');
      const errors = collectErrors(tree, 'test.mustache');
      expect(
        errors.some((e) =>
          e.message.includes('Unquoted mustache attribute value'),
        ),
      ).toBe(false);
    });

    it('detects unquoted mustache in multiple attributes', () => {
      const tree = parse('<div class={{foo}} id={{bar}}></div>');
      const errors = collectErrors(tree, 'test.mustache');
      const unquotedErrors = errors.filter((e) =>
        e.message.includes('Unquoted mustache attribute value'),
      );
      expect(unquotedErrors.length).toBe(2);
    });
  });
});

describe('formatError', () => {
  it('includes file location and error message', () => {
    const error = {
      file: 'test.mustache',
      line: 3,
      column: 3,
      endLine: 3,
      endColumn: 13,
      severity: 'error' as const,
      message: 'Mismatched mustache section: {{/wrong}}',
      nodeText: '{{/wrong}}',
    };
    const source = '{{#items}}\n  <li>{{name}}\n  {{/wrong}}\n</div>';
    const output = formatError(error, source);
    expect(output).toContain('test.mustache:3:3');
    expect(output).toContain('error');
    expect(output).toContain('Mismatched mustache section: {{/wrong}}');
    expect(output).toContain('^^^^^^^^^^');
  });

  it('shows context lines before the error', () => {
    const error = {
      file: 'test.mustache',
      line: 3,
      column: 1,
      endLine: 3,
      endColumn: 10,
      severity: 'error' as const,
      message: 'Syntax error',
      nodeText: 'bad stuff',
    };
    const source = 'line one\nline two\nbad stuff\nline four';
    const output = formatError(error, source);
    expect(output).toContain('line one');
    expect(output).toContain('line two');
    expect(output).toContain('bad stuff');
  });
});

describe('formatSummary', () => {
  it('shows success message when no errors', () => {
    const output = formatSummary(0, 0, 5);
    expect(output).toContain('No errors found');
    expect(output).toContain('5 files checked');
  });

  it('shows error counts', () => {
    const output = formatSummary(3, 2, 10);
    expect(output).toContain('3 errors');
    expect(output).toContain('2 files');
    expect(output).toContain('10 files checked');
  });

  it('uses singular forms correctly', () => {
    const output = formatSummary(1, 1, 1);
    expect(output).toContain('1 error in 1 file');
    expect(output).toContain('1 file checked');
  });
});

describe('resolveFiles', () => {
  let tempDir: string;
  let origCwd: string;

  beforeAll(() => {
    origCwd = process.cwd();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolvefiles-test-'));

    // Create test files
    fs.writeFileSync(path.join(tempDir, 'a.mustache'), '<div>a</div>');
    fs.writeFileSync(path.join(tempDir, 'b.hbs'), '<div>b</div>');
    fs.mkdirSync(path.join(tempDir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'sub', 'c.mustache'), '<div>c</div>');

    // Create vendor dir with a file
    fs.mkdirSync(path.join(tempDir, 'vendor'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'vendor', 'd.mustache'),
      '<div>d</div>',
    );

    // Create node_modules dir with a file
    fs.mkdirSync(path.join(tempDir, 'node_modules', 'pkg'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempDir, 'node_modules', 'pkg', 'e.mustache'),
      '<div>e</div>',
    );

    // Create .git dir with a file
    fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, '.git', 'f.mustache'), '<div>f</div>');

    process.chdir(tempDir);
  });

  afterAll(() => {
    process.chdir(origCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses CLI patterns when provided', async () => {
    const { files } = await resolveFiles(['*.mustache']);
    expect(files.map((f) => path.basename(f))).toEqual(['a.mustache']);
  });

  it('uses config include when no CLI patterns', async () => {
    fs.writeFileSync(
      path.join(tempDir, '.htmlmustache.jsonc'),
      JSON.stringify({ include: ['**/*.mustache'] }),
    );
    const { files } = await resolveFiles([]);
    const basenames = files.map((f) => path.basename(f));
    expect(basenames).toContain('a.mustache');
    expect(basenames).toContain('c.mustache');
  });

  it('excludes node_modules by default', async () => {
    const { files } = await resolveFiles([]);
    const basenames = files.map((f) => path.basename(f));
    expect(basenames).not.toContain('e.mustache');
  });

  it('excludes .git by default', async () => {
    const { files } = await resolveFiles([]);
    const basenames = files.map((f) => path.basename(f));
    expect(basenames).not.toContain('f.mustache');
  });

  it('applies config exclude patterns', async () => {
    fs.writeFileSync(
      path.join(tempDir, '.htmlmustache.jsonc'),
      JSON.stringify({ include: ['**/*.mustache'], exclude: ['vendor/**'] }),
    );
    const { files } = await resolveFiles([]);
    const basenames = files.map((f) => path.basename(f));
    expect(basenames).toContain('a.mustache');
    expect(basenames).not.toContain('d.mustache');
  });

  it('applies exclude even with CLI patterns', async () => {
    fs.writeFileSync(
      path.join(tempDir, '.htmlmustache.jsonc'),
      JSON.stringify({ exclude: ['vendor/**'] }),
    );
    const { files } = await resolveFiles(['**/*.mustache']);
    const basenames = files.map((f) => path.basename(f));
    expect(basenames).toContain('a.mustache');
    expect(basenames).not.toContain('d.mustache');
  });

  it('returns empty files and null config when no patterns and no config', async () => {
    // Remove config file
    const configPath = path.join(tempDir, '.htmlmustache.jsonc');
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);

    const { files, config } = await resolveFiles([]);
    expect(files).toEqual([]);
    expect(config).toBeNull();
  });

  it('returns empty files when config has no include and no CLI patterns', async () => {
    fs.writeFileSync(
      path.join(tempDir, '.htmlmustache.jsonc'),
      JSON.stringify({ printWidth: 100 }),
    );
    const { files, config } = await resolveFiles([]);
    expect(files).toEqual([]);
    expect(config).not.toBeNull();
    expect(config!.include).toBeUndefined();
  });

  it('returns configDir pointing at the config file location', async () => {
    fs.writeFileSync(
      path.join(tempDir, '.htmlmustache.jsonc'),
      JSON.stringify({ include: ['**/*.mustache'] }),
    );
    const { configDir } = await resolveFiles([]);
    // On macOS, process.cwd() resolves symlinks (/var -> /private/var),
    // so compare via realpath to stay portable.
    expect(configDir).toBe(fs.realpathSync(tempDir));
  });

  it('loads an ajvModule referenced from the config and applies its formats to schemas', async () => {
    const configPath = path.join(tempDir, '.htmlmustache.jsonc');
    const ajvPath = path.join(tempDir, 'pl-ajv.mjs');
    const schemaPath = path.join(tempDir, 'pl-card.schema.json');

    fs.writeFileSync(
      ajvPath,
      [
        'const BOOLEAN_STRINGS = new Set(["true","t","1","yes","y","on","false","f","0","no","n","off"]);',
        'export const formats = { "pl-boolean": (v) => typeof v === "string" && BOOLEAN_STRINGS.has(v.toLowerCase()) };',
      ].join('\n'),
    );
    fs.writeFileSync(
      schemaPath,
      JSON.stringify({
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
      }),
    );
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        include: ['**/*.mustache'],
        ajvModule: './pl-ajv.mjs',
        customTags: [{ name: 'pl-card', schema: './pl-card.schema.json' }],
      }),
    );

    const { schemaRegistry, schemaLoadErrors } = await resolveFiles([]);
    expect(schemaLoadErrors ?? []).toEqual([]);
    expect(schemaRegistry?.schemas.has('pl-card')).toBe(true);

    const compiled = schemaRegistry!.schemas.get('pl-card')!;
    expect(
      compiled.validate({
        tag: 'pl-card',
        attributes: { answers: 'Yes' },
        text: '',
        innerHtml: '',
        children: [],
      }),
    ).toBe(true);
    expect(
      compiled.validate({
        tag: 'pl-card',
        attributes: { answers: 'maybe' },
        text: '',
        innerHtml: '',
        children: [],
      }),
    ).toBe(false);
  });

  it('loads an ajvModule keyword and registers it on the validator', async () => {
    const configPath = path.join(tempDir, '.htmlmustache.jsonc');
    const ajvPath = path.join(tempDir, 'pl-keywords-ajv.mjs');
    const schemaPath = path.join(tempDir, 'pl-list.schema.json');

    fs.writeFileSync(
      ajvPath,
      [
        'export const keywords = {',
        '  "unique-child-text": {',
        '    type: "array",',
        '    validate: (_schema, data) => {',
        '      if (!Array.isArray(data)) return true;',
        '      const seen = new Set();',
        '      for (const child of data) {',
        '        const t = child && typeof child === "object" ? child.text : undefined;',
        '        if (typeof t !== "string") continue;',
        '        if (seen.has(t)) return false;',
        '        seen.add(t);',
        '      }',
        '      return true;',
        '    },',
        '  },',
        '};',
      ].join('\n'),
    );
    fs.writeFileSync(
      schemaPath,
      JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { children: { 'unique-child-text': true } },
      }),
    );
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        include: ['**/*.mustache'],
        ajvModule: './pl-keywords-ajv.mjs',
        customTags: [{ name: 'pl-list', schema: './pl-list.schema.json' }],
      }),
    );

    const { schemaRegistry, schemaLoadErrors } = await resolveFiles([]);
    expect(schemaLoadErrors ?? []).toEqual([]);
    expect(schemaRegistry?.customKeywords.has('unique-child-text')).toBe(true);

    const compiled = schemaRegistry!.schemas.get('pl-list')!;
    expect(
      compiled.validate({
        tag: 'pl-list',
        attributes: {},
        text: '',
        innerHtml: '',
        children: [
          { tag: 'li', attributes: {}, text: 'a', innerHtml: 'a' },
          { tag: 'li', attributes: {}, text: 'b', innerHtml: 'b' },
        ],
      }),
    ).toBe(true);
    expect(
      compiled.validate({
        tag: 'pl-list',
        attributes: {},
        text: '',
        innerHtml: '',
        children: [
          { tag: 'li', attributes: {}, text: 'a', innerHtml: 'a' },
          { tag: 'li', attributes: {}, text: 'a', innerHtml: 'a' },
        ],
      }),
    ).toBe(false);
  });

  it('reports a schemaLoadError when ajvModule cannot be loaded', async () => {
    const configPath = path.join(tempDir, '.htmlmustache.jsonc');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        include: ['**/*.mustache'],
        ajvModule: './missing-ajv.mjs',
      }),
    );
    const { schemaLoadErrors } = await resolveFiles([]);
    expect(schemaLoadErrors?.length ?? 0).toBeGreaterThan(0);
    expect(schemaLoadErrors![0].message).toContain('missing-ajv.mjs');
  });
});

describe('consecutive same-name sections', () => {
  it('detects consecutive same-type same-name sections', () => {
    const tree = parse('{{#x}}a{{/x}}{{#x}}b{{/x}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some(
        (e) =>
          e.message.includes('Consecutive duplicate section') &&
          e.severity === 'warning',
      ),
    ).toBe(true);
  });

  it('detects consecutive inverted sections', () => {
    const tree = parse('{{^x}}a{{/x}}{{^x}}b{{/x}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some(
        (e) =>
          e.message.includes('Consecutive duplicate section') &&
          e.message.includes('{{^x}}'),
      ),
    ).toBe(true);
  });

  it('does not flag different-type sections', () => {
    const tree = parse('{{#x}}a{{/x}}{{^x}}b{{/x}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message.includes('Consecutive duplicate section')),
    ).toBe(false);
  });

  it('does not flag different-name sections', () => {
    const tree = parse('{{#x}}a{{/x}}{{#y}}b{{/y}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message.includes('Consecutive duplicate section')),
    ).toBe(false);
  });

  it('flags with whitespace-only gap', () => {
    const tree = parse('{{#x}}a{{/x}}  \n  {{#x}}b{{/x}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message.includes('Consecutive duplicate section')),
    ).toBe(true);
  });

  it('does not flag with non-whitespace between sections', () => {
    const tree = parse('{{#x}}a{{/x}}text{{#x}}b{{/x}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message.includes('Consecutive duplicate section')),
    ).toBe(false);
  });

  it('severity is warning, not error', () => {
    const tree = parse('{{^foo}}a{{/foo}}{{^foo}}b{{/foo}}');
    const errors = collectErrors(tree, 'test.mustache');
    const consecutive = errors.find((e) =>
      e.message.includes('Consecutive duplicate section'),
    );
    expect(consecutive).toBeDefined();
    expect(consecutive!.severity).toBe('warning');
  });

  it('provides fix data', () => {
    const tree = parse('{{#x}}a{{/x}}{{#x}}b{{/x}}');
    const errors = collectErrors(tree, 'test.mustache');
    const consecutive = errors.find((e) =>
      e.message.includes('Consecutive duplicate section'),
    );
    expect(consecutive).toBeDefined();
    expect(consecutive!.fix).toBeDefined();
    expect(consecutive!.fix!.length).toBe(1);
    expect(consecutive!.fixDescription).toBe('Merge consecutive sections');
  });
});

describe('self-closing non-void tags', () => {
  it('detects self-closing div', () => {
    const tree = parse('<div/>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message === 'Self-closing non-void element: <div/>'),
    ).toBe(true);
  });

  it('detects self-closing span with attributes', () => {
    const tree = parse('<span class="x" />');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some(
        (e) => e.message === 'Self-closing non-void element: <span/>',
      ),
    ).toBe(true);
  });

  it('allows self-closing void elements', () => {
    const tree = parse('<br/><hr/><img src="x"/><input type="text"/>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message.includes('Self-closing non-void')),
    ).toBe(false);
  });

  it('allows void elements without self-closing', () => {
    const tree = parse('<br><hr><img src="x"><input type="text">');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message.includes('Self-closing non-void')),
    ).toBe(false);
  });

  it('provides fix that adds explicit close tag', () => {
    const source = '<div/>';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    const error = errors.find((e) =>
      e.message.includes('Self-closing non-void'),
    );
    expect(error).toBeDefined();
    expect(error!.fix).toBeDefined();
    expect(error!.fix!.length).toBe(1);
    expect(error!.fixDescription).toBe(
      'Replace self-closing syntax with explicit close tag',
    );
  });

  it('fix produces correct output', () => {
    const source = '<div/>';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    const result = applyFixes(source, errors);
    expect(result).toBe('<div></div>');
  });

  it('fix preserves attributes', () => {
    const source = '<span class="x" />';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    const result = applyFixes(source, errors);
    expect(result).toBe('<span class="x"></span>');
  });
});

describe('duplicate attributes', () => {
  it('detects plain duplicate attributes', () => {
    const tree = parse('<div a="1" a="2"></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some((e) => e.message === 'Duplicate attribute "a"')).toBe(
      true,
    );
  });

  it('detects unconditional + conditional duplicate', () => {
    const tree = parse('<div a="1" {{#foo}}a="2"{{/foo}}></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some(
        (e) => e.message === 'Duplicate attribute "a" (when foo is truthy)',
      ),
    ).toBe(true);
  });

  it('detects duplicate across independent sections', () => {
    const tree = parse(
      '<div {{#foo}}a="1"{{/foo}} {{#bar}}a="2"{{/bar}}></div>',
    );
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some(
        (e) =>
          e.message ===
          'Duplicate attribute "a" (when foo is truthy, bar is truthy)',
      ),
    ).toBe(true);
  });

  it('detects boolean attribute duplicate', () => {
    const tree = parse('<input disabled {{#x}}disabled{{/x}}>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some(
        (e) =>
          e.message === 'Duplicate attribute "disabled" (when x is truthy)',
      ),
    ).toBe(true);
  });

  it('detects case-insensitive duplicates', () => {
    const tree = parse('<div Class="a" class="b"></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message === 'Duplicate attribute "class"'),
    ).toBe(true);
  });

  it('allows mutually exclusive pair', () => {
    const tree = parse('<div {{#x}}a="1"{{/x}} {{^x}}a="2"{{/x}}></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some((e) => e.message.includes('Duplicate attribute'))).toBe(
      false,
    );
  });

  it('allows deeply nested exclusive on same variable', () => {
    const tree = parse(
      '<div {{#a}}{{#b}}x="1"{{/b}}{{/a}} {{^a}}x="2"{{/a}}></div>',
    );
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some((e) => e.message.includes('Duplicate attribute'))).toBe(
      false,
    );
  });

  it('does not flag bare interpolation', () => {
    const tree = parse('<div {{attrs}} class="x"></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some((e) => e.message.includes('Duplicate attribute'))).toBe(
      false,
    );
  });

  it('does not flag different attribute names', () => {
    const tree = parse('<div a="1" b="2"></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some((e) => e.message.includes('Duplicate attribute'))).toBe(
      false,
    );
  });
});

describe('unescaped entities', () => {
  it('detects > in text content', () => {
    const tree = parse('<p>a > b</p>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some((e) => e.message.includes('Unescaped ">"'))).toBe(true);
  });

  it('detects bare & in text content', () => {
    const tree = parse('<p>foo & bar</p>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some((e) => e.message.includes('Unescaped "&"'))).toBe(true);
  });

  it('does not flag valid entities', () => {
    const tree = parse('<p>&gt; &amp; &nbsp;</p>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some((e) => e.message.includes('Unescaped'))).toBe(false);
  });

  it('does not flag > or & in attribute values', () => {
    const tree = parse('<a title="a > b & c">link</a>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some((e) => e.message.includes('Unescaped'))).toBe(false);
  });

  it('severity is warning', () => {
    const tree = parse('<p>a > b</p>');
    const errors = collectErrors(tree, 'test.mustache');
    const unescaped = errors.find((e) => e.message.includes('Unescaped'));
    expect(unescaped).toBeDefined();
    expect(unescaped!.severity).toBe('warning');
  });

  it('fix replaces > with &gt;', () => {
    const source = '<p>a > b</p>';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    const result = applyFixes(source, errors);
    expect(result).toBe('<p>a &gt; b</p>');
  });

  it('fix replaces & with &amp;', () => {
    const source = '<p>foo & bar</p>';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    const result = applyFixes(source, errors);
    expect(result).toBe('<p>foo &amp; bar</p>');
  });

  it('fix replaces multiple > in same text node', () => {
    const source = '<p>a > b > c</p>';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    const result = applyFixes(source, errors);
    expect(result).toBe('<p>a &gt; b &gt; c</p>');
  });
});

describe('applyFixes', () => {
  it('applies unquoted attribute fix', () => {
    const source = '<div class={{foo}}></div>';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    const result = applyFixes(source, errors);
    expect(result).toBe('<div class="{{foo}}"></div>');
  });

  it('applies consecutive section merge fix', () => {
    const source = '{{#x}}a{{/x}}{{#x}}b{{/x}}';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    const result = applyFixes(source, errors);
    expect(result).toBe('{{#x}}ab{{/x}}');
  });

  it('applies multiple fixes in one file', () => {
    const source = '<div size={{s}}></div>\n{{^m}}a{{/m}}{{^m}}b{{/m}}';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    const result = applyFixes(source, errors);
    expect(result).toContain('"{{s}}"');
    expect(result).toContain('{{^m}}ab{{/m}}');
  });

  it('returns source unchanged when no fixes', () => {
    const source = '<div class="ok">text</div>';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    const result = applyFixes(source, errors);
    expect(result).toBe(source);
  });
});

describe('prefer mustache comments rule', () => {
  it('does not flag HTML comments by default (no rules)', () => {
    const tree = parse('<!-- a comment -->');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some((e) => e.message.includes('HTML comment found'))).toBe(
      false,
    );
  });

  it('flags HTML comments when rule is enabled', () => {
    const tree = parse('<!-- a comment -->');
    const errors = collectErrors(tree, 'test.mustache', {
      preferMustacheComments: 'warning',
    });
    expect(errors.some((e) => e.message.includes('HTML comment found'))).toBe(
      true,
    );
    expect(
      errors.find((e) => e.message.includes('HTML comment found'))!.severity,
    ).toBe('warning');
  });

  it('uses error severity when configured', () => {
    const tree = parse('<!-- a comment -->');
    const errors = collectErrors(tree, 'test.mustache', {
      preferMustacheComments: 'error',
    });
    const err = errors.find((e) => e.message.includes('HTML comment found'));
    expect(err).toBeDefined();
    expect(err!.severity).toBe('error');
  });

  it('provides fix that converts to mustache comment', () => {
    const source = '<!-- a comment -->';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache', {
      preferMustacheComments: 'warning',
    });
    const result = applyFixes(source, errors);
    expect(result).toBe('{{! a comment }}');
  });

  it('fix handles multiline HTML comments', () => {
    const source = '<!--\n  multi\n  line\n-->';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache', {
      preferMustacheComments: 'warning',
    });
    const result = applyFixes(source, errors);
    expect(result).toBe('{{! multi\n  line }}');
  });

  it('fix handles empty HTML comments', () => {
    const source = '<!---->';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache', {
      preferMustacheComments: 'warning',
    });
    const result = applyFixes(source, errors);
    expect(result).toBe('{{!  }}');
  });
});

describe('disable directives', () => {
  it('HTML comment disables a specific rule', () => {
    const tree = parse(
      '<!-- htmlmustache-disable selfClosingNonVoidTags -->\n<div/>',
    );
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message.includes('Self-closing non-void')),
    ).toBe(false);
  });

  it('mustache comment disables a specific rule', () => {
    const tree = parse(
      '{{! htmlmustache-disable selfClosingNonVoidTags }}\n<div/>',
    );
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message.includes('Self-closing non-void')),
    ).toBe(false);
  });

  it('multiple rules disabled with multiple comments', () => {
    const tree = parse(
      '<!-- htmlmustache-disable selfClosingNonVoidTags -->\n{{! htmlmustache-disable unescapedEntities }}\n<div/><p>a > b</p>',
    );
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message.includes('Self-closing non-void')),
    ).toBe(false);
    expect(errors.some((e) => e.message.includes('Unescaped'))).toBe(false);
  });

  it('only the named rule is disabled, others still reported', () => {
    const tree = parse(
      '<!-- htmlmustache-disable unescapedEntities -->\n<div/><p>a > b</p>',
    );
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message.includes('Self-closing non-void')),
    ).toBe(true);
    expect(errors.some((e) => e.message.includes('Unescaped'))).toBe(false);
  });

  it('unknown rule names are ignored', () => {
    const tree = parse('<!-- htmlmustache-disable nonExistentRule -->\n<div/>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message.includes('Self-closing non-void')),
    ).toBe(true);
  });

  it('disable comments themselves do not trigger preferMustacheComments', () => {
    const tree = parse('<!-- htmlmustache-disable selfClosingNonVoidTags -->');
    const errors = collectErrors(tree, 'test.mustache', {
      preferMustacheComments: 'warning',
    });
    expect(errors.some((e) => e.message.includes('HTML comment found'))).toBe(
      false,
    );
  });
});

describe('unrecognized HTML tags', () => {
  it('allows standard HTML tags', () => {
    const tree = parse('<div><span><input></span></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message.includes('Unrecognized HTML tag')),
    ).toBe(false);
  });

  it('flags unrecognized tags', () => {
    const tree = parse('<foo></foo>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message === 'Unrecognized HTML tag: <foo>'),
    ).toBe(true);
  });

  it('flags typo tags', () => {
    const tree = parse('<dvi></dvi>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message === 'Unrecognized HTML tag: <dvi>'),
    ).toBe(true);
  });

  it('flags custom elements with hyphens when not in customTags', () => {
    const tree = parse('<my-component></my-component>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message === 'Unrecognized HTML tag: <my-component>'),
    ).toBe(true);
  });

  it('allows custom elements listed in customTagNames', () => {
    const tree = parse('<my-component></my-component>');
    const errors = collectErrors(tree, 'test.mustache', undefined, [
      'my-component',
    ]);
    expect(
      errors.some((e) => e.message.includes('Unrecognized HTML tag')),
    ).toBe(false);
  });

  it('allows custom tags from config (case-insensitive)', () => {
    const tree = parse('<codeblock></codeblock>');
    const errors = collectErrors(tree, 'test.mustache', undefined, [
      'CodeBlock',
    ]);
    expect(
      errors.some((e) => e.message.includes('Unrecognized HTML tag')),
    ).toBe(false);
  });

  it('does not flag tags inside <svg>', () => {
    const tree = parse('<svg><path d="M0 0"/></svg>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message.includes('Unrecognized HTML tag')),
    ).toBe(false);
  });

  it('does not flag tags inside <math>', () => {
    const tree = parse('<math><mrow><mi>x</mi></mrow></math>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message.includes('Unrecognized HTML tag')),
    ).toBe(false);
  });

  it('can be disabled via config', () => {
    const tree = parse('<foo></foo>');
    const errors = collectErrors(tree, 'test.mustache', {
      unrecognizedHtmlTags: 'off',
    });
    expect(
      errors.some((e) => e.message.includes('Unrecognized HTML tag')),
    ).toBe(false);
  });

  it('can be set to warning', () => {
    const tree = parse('<foo></foo>');
    const errors = collectErrors(tree, 'test.mustache', {
      unrecognizedHtmlTags: 'warning',
    });
    const err = errors.find((e) => e.message.includes('Unrecognized HTML tag'));
    expect(err).toBeDefined();
    expect(err!.severity).toBe('warning');
  });

  it('can be disabled via inline comment', () => {
    const tree = parse(
      '{{! htmlmustache-disable unrecognizedHtmlTags }}\n<foo></foo>',
    );
    const errors = collectErrors(tree, 'test.mustache');
    expect(
      errors.some((e) => e.message.includes('Unrecognized HTML tag')),
    ).toBe(false);
  });
});

describe('custom rules', () => {
  it('detects custom rule match by tag', () => {
    const tree = parse('<div><font></font></div>');
    const errors = collectErrors(tree, 'test.mustache', undefined, undefined, [
      { id: 'no-font', selector: 'font', message: 'Deprecated element' },
    ]);
    expect(errors.some((e) => e.message === 'Deprecated element')).toBe(true);
  });

  it('uses custom rule severity', () => {
    const tree = parse('<font></font>');
    const errors = collectErrors(tree, 'test.mustache', undefined, undefined, [
      {
        id: 'no-font',
        selector: 'font',
        message: 'Deprecated',
        severity: 'warning',
      },
    ]);
    const err = errors.find((e) => e.message === 'Deprecated');
    expect(err).toBeDefined();
    expect(err!.severity).toBe('warning');
  });

  it('defaults custom rule to error severity', () => {
    const tree = parse('<font></font>');
    const errors = collectErrors(tree, 'test.mustache', undefined, undefined, [
      { id: 'no-font', selector: 'font', message: 'Deprecated' },
    ]);
    const err = errors.find((e) => e.message === 'Deprecated');
    expect(err).toBeDefined();
    expect(err!.severity).toBe('error');
  });

  it('respects inline disable for custom rule id', () => {
    const tree = parse('<!-- htmlmustache-disable no-font -->\n<font></font>');
    const errors = collectErrors(tree, 'test.mustache', undefined, undefined, [
      { id: 'no-font', selector: 'font', message: 'Deprecated' },
    ]);
    expect(errors.some((e) => e.message === 'Deprecated')).toBe(false);
  });

  it('custom rule with attribute selector', () => {
    const tree = parse('<div style="color:red"></div><div></div>');
    const errors = collectErrors(tree, 'test.mustache', undefined, undefined, [
      { id: 'no-style', selector: '[style]', message: 'No inline styles' },
    ]);
    expect(errors.filter((e) => e.message === 'No inline styles')).toHaveLength(
      1,
    );
  });

  it('custom rule with comma-separated selectors', () => {
    const tree = parse('<b></b><i></i><span></span>');
    const errors = collectErrors(tree, 'test.mustache', undefined, undefined, [
      { id: 'no-bi', selector: 'b, i', message: 'Use semantic tags' },
    ]);
    expect(
      errors.filter((e) => e.message === 'Use semantic tags'),
    ).toHaveLength(2);
  });

  it('skips custom rule with severity off', () => {
    const tree = parse('<font></font>');
    const errors = collectErrors(tree, 'test.mustache', undefined, undefined, [
      {
        id: 'no-font',
        selector: 'font',
        message: 'Deprecated',
        severity: 'off',
      },
    ]);
    expect(errors.some((e) => e.message === 'Deprecated')).toBe(false);
  });
});

describe('custom tag schema', () => {
  const plMultipleChoiceRegistry = () =>
    schemaRegistryFor('pl-multiple-choice', PL_MULTIPLE_CHOICE_SCHEMA);

  it('detects missing required attribute on inline schema', () => {
    const registry = schemaRegistryFor('x-card', {
      $schema: DRAFT_2020_12,
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: { kind: { type: 'string' } },
          required: ['kind'],
        },
      },
    });
    const tree = parse('<x-card></x-card>');
    const errors = collectErrors(
      tree,
      'test.mustache',
      undefined,
      ['x-card'],
      undefined,
      { registry },
    );

    expect(
      errors.some(
        (e) =>
          e.ruleName === 'customTagSchema' &&
          e.message === '<x-card> is missing required attribute "kind".',
      ),
    ).toBe(true);
  });

  it('reports unknown attribute at the attribute location with ruleName', () => {
    const registry = schemaRegistryFor('x-card', {
      $schema: DRAFT_2020_12,
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: { kind: { type: 'string' } },
          additionalProperties: false,
        },
      },
    });
    const tree = parse('<x-card kind="ok"\n  extra="x"\n></x-card>');
    const errors = collectErrors(
      tree,
      'test.mustache',
      undefined,
      ['x-card'],
      undefined,
      { registry },
    );
    const err = errors.find(
      (e) =>
        e.ruleName === 'customTagSchema' &&
        e.message === 'Unknown attribute "extra" on <x-card>.',
    );

    expect(err).toBeDefined();
    expect(err!.line).toBe(2);
    expect(err!.column).toBe(3);
  });

  it('waives mustache-bearing enum and number values but still reports unknown attributes', () => {
    const registry = schemaRegistryFor('x-card', {
      $schema: DRAFT_2020_12,
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: {
            variant: { enum: ['primary', 'secondary'] },
            count: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    });
    const tree = parse(
      '<x-card variant="{{variant}}" count="{{count}}" mystery="x"></x-card>',
    );
    const errors = collectErrors(
      tree,
      'test.mustache',
      undefined,
      ['x-card'],
      undefined,
      { registry },
    );
    const schemaErrors = errors.filter((e) => e.ruleName === 'customTagSchema');

    expect(schemaErrors).toHaveLength(1);
    expect(schemaErrors[0].message).toBe(
      'Unknown attribute "mystery" on <x-card>.',
    );
  });

  it('rewrites attribute enum and type schema messages using HTML terms', () => {
    const registry = schemaRegistryFor('x-card', {
      $schema: DRAFT_2020_12,
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: {
            variant: { enum: ['primary', 'secondary'] },
            count: { type: 'number' },
          },
        },
      },
    });
    const tree = parse('<x-card variant="tertiary" count="many"></x-card>');
    const errors = collectErrors(
      tree,
      'test.mustache',
      undefined,
      ['x-card'],
      undefined,
      { registry },
    );

    expect(
      errors.some(
        (e) =>
          e.ruleName === 'customTagSchema' &&
          e.message ===
            'Attribute "variant" on <x-card> must be one of: "primary", "secondary".',
      ),
    ).toBe(true);
    expect(
      errors.some(
        (e) =>
          e.ruleName === 'customTagSchema' &&
          e.message === 'Attribute "count" on <x-card> must be number.',
      ),
    ).toBe(true);
  });

  it('rewrites attribute numeric bounds using HTML terms', () => {
    const registry = schemaRegistryFor('x-card', {
      $schema: DRAFT_2020_12,
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: {
            score: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
    });
    const tree = parse('<x-card score="2"></x-card>');
    const errors = collectErrors(
      tree,
      'test.mustache',
      undefined,
      ['x-card'],
      undefined,
      { registry },
    );

    expect(
      errors.some(
        (e) =>
          e.ruleName === 'customTagSchema' &&
          e.message === 'Attribute "score" on <x-card> must be <= 1.',
      ),
    ).toBe(true);
  });

  it('accepts boolean attributes with boolean schemas', () => {
    const registry = schemaRegistryFor('x-card', {
      $schema: DRAFT_2020_12,
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: { inline: { type: 'boolean' } },
        },
      },
    });
    const tree = parse('<x-card inline></x-card>');
    const errors = collectErrors(
      tree,
      'test.mustache',
      undefined,
      ['x-card'],
      undefined,
      { registry },
    );

    expect(errors.some((e) => e.ruleName === 'customTagSchema')).toBe(false);
  });

  it('waives mustache-bearing child attribute values in parent schemas', () => {
    const registry = schemaRegistryFor('x-list', {
      $schema: DRAFT_2020_12,
      type: 'object',
      properties: {
        children: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tag: { const: 'x-item' },
              attributes: {
                type: 'object',
                properties: {
                  score: { type: 'number', minimum: 0, maximum: 1 },
                },
              },
            },
          },
        },
      },
    });
    const tree = parse('<x-list><x-item score="{{score}}"></x-item></x-list>');
    const errors = collectErrors(
      tree,
      'test.mustache',
      undefined,
      ['x-list', 'x-item'],
      undefined,
      { registry },
    );

    expect(errors.some((e) => e.ruleName === 'customTagSchema')).toBe(false);
  });

  it('does not waive unrelated cross-attribute schema errors', () => {
    const registry = schemaRegistryFor('x-card', {
      $schema: DRAFT_2020_12,
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: {
            foo: { type: 'string' },
            inline: { type: 'boolean' },
            display: { enum: ['block'] },
          },
          allOf: [{ not: { required: ['inline', 'display'] } }],
        },
      },
    });
    const tree = parse(
      '<x-card foo="{{value}}" inline display="block"></x-card>',
    );
    const errors = collectErrors(
      tree,
      'test.mustache',
      undefined,
      ['x-card'],
      undefined,
      { registry },
    );

    expect(errors.some((e) => e.ruleName === 'customTagSchema')).toBe(true);
  });

  it('waives then-branch errors caused by mustache-bearing conditional operands', () => {
    const registry = schemaRegistryFor('x-card', {
      $schema: DRAFT_2020_12,
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: {
            size: { type: 'integer' },
            display: { const: 'dropdown' },
          },
          allOf: [
            { if: { required: ['size'] }, then: { required: ['display'] } },
          ],
        },
      },
    });
    const tree = parse('<x-card size="{{n}}"></x-card>');
    const errors = collectErrors(
      tree,
      'test.mustache',
      undefined,
      ['x-card'],
      undefined,
      { registry },
    );

    expect(errors.some((e) => e.ruleName === 'customTagSchema')).toBe(false);
  });

  it('does not waive literal sibling child violations due to another child mustache attribute', () => {
    const registry = schemaRegistryFor('x-list', {
      $schema: DRAFT_2020_12,
      type: 'object',
      properties: {
        children: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              attributes: {
                type: 'object',
                properties: {
                  score: { type: 'number' },
                  feedback: { type: 'string' },
                },
                not: { required: ['score', 'feedback'] },
              },
            },
          },
        },
      },
    });
    const tree = parse(
      '<x-list><x-item score="{{s}}"></x-item><x-item score="1" feedback="bad"></x-item></x-list>',
    );
    const errors = collectErrors(
      tree,
      'test.mustache',
      undefined,
      ['x-list', 'x-item'],
      undefined,
      { registry },
    );

    expect(errors.some((e) => e.ruleName === 'customTagSchema')).toBe(true);
  });

  it('includes section-flattened children inside mustache sections', () => {
    const registry = schemaRegistryFor('x-list', {
      $schema: DRAFT_2020_12,
      type: 'object',
      properties: {
        children: {
          type: 'array',
          items: {
            type: 'object',
            properties: { tag: { const: 'x-item' } },
            required: ['tag'],
          },
        },
      },
    });
    const tree = parse('<x-list>{{#items}}<x-bad></x-bad>{{/items}}</x-list>');
    const errors = collectErrors(
      tree,
      'test.mustache',
      undefined,
      ['x-list', 'x-bad'],
      undefined,
      { registry },
    );
    const err = errors.find((e) => e.ruleName === 'customTagSchema');

    expect(err).toBeDefined();
    expect(err!.message).toBe(
      '<x-list> only allows <x-item> children; found <x-bad>.',
    );
    expect(err!.nodeText).toBe('<x-bad>');
  });

  it('inline disable suppresses customTagSchema', () => {
    const registry = schemaRegistryFor('x-card', {
      $schema: DRAFT_2020_12,
      type: 'object',
      properties: {
        attributes: {
          type: 'object',
          properties: { kind: { type: 'string' } },
          required: ['kind'],
        },
      },
    });
    const tree = parse(
      '{{! htmlmustache-disable customTagSchema }}\n<x-card></x-card>',
    );
    const errors = collectErrors(
      tree,
      'test.mustache',
      undefined,
      ['x-card'],
      undefined,
      { registry },
    );

    expect(errors.some((e) => e.ruleName === 'customTagSchema')).toBe(false);
  });

  it('validates representative pl-multiple-choice required answers-name', () => {
    const tree = parse('<pl-multiple-choice></pl-multiple-choice>');
    const errors = collectErrors(
      tree,
      'test.mustache',
      undefined,
      ['pl-multiple-choice', 'pl-answer'],
      undefined,
      { registry: plMultipleChoiceRegistry() },
    );

    expect(
      errors.some(
        (e) =>
          e.ruleName === 'customTagSchema' &&
          e.message ===
            '<pl-multiple-choice> is missing required attribute "answers-name".',
      ),
    ).toBe(true);
  });

  it('validates representative pl-multiple-choice closed attributes with html globals', () => {
    const tree = parse(
      '<pl-multiple-choice answers-name="ans" data-test="ok" mystery="x"></pl-multiple-choice>',
    );
    const errors = collectErrors(
      tree,
      'test.mustache',
      undefined,
      ['pl-multiple-choice', 'pl-answer'],
      undefined,
      { registry: plMultipleChoiceRegistry() },
    );
    const schemaErrors = errors.filter((e) => e.ruleName === 'customTagSchema');

    expect(schemaErrors).toHaveLength(1);
    expect(schemaErrors[0].message).toBe(
      'Unknown attribute "mystery" on <pl-multiple-choice>.',
    );
    expect(schemaErrors[0].nodeText).toContain('mystery');
  });

  it('validates representative pl-multiple-choice dropdown-only size', () => {
    const tree = parse(
      '<pl-multiple-choice answers-name="ans" size="4"></pl-multiple-choice>',
    );
    const errors = collectErrors(
      tree,
      'test.mustache',
      undefined,
      ['pl-multiple-choice', 'pl-answer'],
      undefined,
      { registry: plMultipleChoiceRegistry() },
    );

    expect(
      errors.some(
        (e) =>
          e.ruleName === 'customTagSchema' && e.message.includes('display'),
      ),
    ).toBe(true);
  });

  it('validates representative pl-multiple-choice child tag', () => {
    const tree = parse(
      '<pl-multiple-choice answers-name="ans"><span correct="true" feedback="ok" score="1"></span></pl-multiple-choice>',
    );
    const errors = collectErrors(
      tree,
      'test.mustache',
      undefined,
      ['pl-multiple-choice', 'pl-answer'],
      undefined,
      { registry: plMultipleChoiceRegistry() },
    );

    expect(
      errors.some(
        (e) =>
          e.ruleName === 'customTagSchema' &&
          e.message ===
            '<pl-multiple-choice> only allows <pl-answer> children; found <span>.',
      ),
    ).toBe(true);
  });

  it('validates representative pl-multiple-choice builtin-grading false child score', () => {
    const tree = parse(
      '<pl-multiple-choice answers-name="ans" builtin-grading="false"><pl-answer correct="true" feedback="ok" score="1"></pl-answer></pl-multiple-choice>',
    );
    const errors = collectErrors(
      tree,
      'test.mustache',
      undefined,
      ['pl-multiple-choice', 'pl-answer'],
      undefined,
      { registry: plMultipleChoiceRegistry() },
    );

    expect(errors.some((e) => e.ruleName === 'customTagSchema')).toBe(true);
  });
});

describe('rules config overrides', () => {
  it('disables a default-on rule when set to off', () => {
    const tree = parse('<p>a > b</p>');
    const errors = collectErrors(tree, 'test.mustache', {
      unescapedEntities: 'off',
    });
    expect(errors.some((e) => e.message.includes('Unescaped'))).toBe(false);
  });

  it('changes severity of a rule', () => {
    const tree = parse('{{#x}}a{{/x}}{{#x}}b{{/x}}');
    const errors = collectErrors(tree, 'test.mustache', {
      consecutiveDuplicateSections: 'error',
    });
    const consecutive = errors.find((e) =>
      e.message.includes('Consecutive duplicate section'),
    );
    expect(consecutive).toBeDefined();
    expect(consecutive!.severity).toBe('error');
  });
});

describe('formatSummary with warnings', () => {
  it('shows only warnings', () => {
    const output = formatSummary(0, 1, 5, 2);
    expect(output).toContain('2 warnings');
    expect(output).not.toContain('error');
  });

  it('shows both errors and warnings', () => {
    const output = formatSummary(3, 2, 10, 1);
    expect(output).toContain('3 errors');
    expect(output).toContain('1 warning');
  });
});
