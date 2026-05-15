import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';

import { findConfigFile, loadConfigFile, loadConfigFileForPath } from '../../../js/shared/configFile.js';
import { parseJsonc, validateConfig } from '../../../js/shared/configSchema.js';

describe('parseJsonc', () => {
  it('parses plain JSON', () => {
    expect(parseJsonc('{"a": 1}')).toEqual({ a: 1 });
  });

  it('strips line comments', () => {
    const input = `{
      // this is a comment
      "a": 1
    }`;
    expect(parseJsonc(input)).toEqual({ a: 1 });
  });

  it('strips block comments', () => {
    const input = `{
      /* block comment */
      "a": 1
    }`;
    expect(parseJsonc(input)).toEqual({ a: 1 });
  });

  it('strips multi-line block comments', () => {
    const input = `{
      /*
       * multi-line
       * block comment
       */
      "a": 1
    }`;
    expect(parseJsonc(input)).toEqual({ a: 1 });
  });

  it('removes trailing commas before }', () => {
    const input = '{"a": 1, "b": 2,}';
    expect(parseJsonc(input)).toEqual({ a: 1, b: 2 });
  });

  it('removes trailing commas before ]', () => {
    const input = '{"a": [1, 2, 3,]}';
    expect(parseJsonc(input)).toEqual({ a: [1, 2, 3] });
  });

  it('preserves comments inside strings', () => {
    const input = '{"a": "hello // world", "b": "foo /* bar */"}';
    const result = parseJsonc(input) as Record<string, string>;
    expect(result.a).toBe('hello // world');
    expect(result.b).toBe('foo /* bar */');
  });

  it('handles escaped quotes in strings', () => {
    const input = '{"a": "he said \\"hello\\""}';
    const result = parseJsonc(input) as Record<string, string>;
    expect(result.a).toBe('he said "hello"');
  });

  it('parses a realistic config', () => {
    const input = `{
      // Formatting
      "printWidth": 100,
      "indentSize": 4,
      "mustacheSpaces": true,

      // Custom tags
      "customTags": [
        {
          "name": "pl-code",
          "languageAttribute": "language",
          "languageMap": { "python3": "python" },
        },
      ],
    }`;
    const result = parseJsonc(input) as Record<string, unknown>;
    expect(result.printWidth).toBe(100);
    expect(result.indentSize).toBe(4);
    expect(result.mustacheSpaces).toBe(true);
    expect(result.customTags).toHaveLength(1);
  });
});

describe('validateConfig', () => {
  it('returns empty config for null', () => {
    expect(validateConfig(null)).toEqual({});
  });

  it('returns empty config for non-object', () => {
    expect(validateConfig('string')).toEqual({});
    expect(validateConfig(42)).toEqual({});
  });

  it('returns empty config for array', () => {
    expect(validateConfig([1, 2])).toEqual({});
  });

  it('validates printWidth', () => {
    expect(validateConfig({ printWidth: 100 })).toEqual({ printWidth: 100 });
    expect(validateConfig({ printWidth: 0 })).toEqual({});
    expect(validateConfig({ printWidth: -1 })).toEqual({});
    expect(validateConfig({ printWidth: 'string' })).toEqual({});
  });

  it('validates indentSize', () => {
    expect(validateConfig({ indentSize: 4 })).toEqual({ indentSize: 4 });
    expect(validateConfig({ indentSize: 0 })).toEqual({});
    expect(validateConfig({ indentSize: 'string' })).toEqual({});
  });

  it('validates mustacheSpaces', () => {
    expect(validateConfig({ mustacheSpaces: true })).toEqual({ mustacheSpaces: true });
    expect(validateConfig({ mustacheSpaces: 'yes' })).toEqual({});
  });

  it('ignores unknown keys', () => {
    expect(validateConfig({ unknownKey: 'value', printWidth: 80 })).toEqual({ printWidth: 80 });
  });

  it('validates customTags', () => {
    const result = validateConfig({
      customTags: [
        { name: 'pl-code', languageAttribute: 'language', indent: 'always' },
        { name: '' }, // invalid: empty name
        { noName: true }, // invalid: no name
        'not-an-object', // invalid
      ],
    });
    expect(result.customTags).toHaveLength(1);
    expect(result.customTags![0].name).toBe('pl-code');
    expect(result.customTags![0].languageAttribute).toBe('language');
    expect(result.customTags![0].indent).toBe('always');
  });

  it('validates customTags indent mode', () => {
    const result = validateConfig({
      customTags: [
        { name: 'tag1', indent: 'never' },
        { name: 'tag2', indent: 'invalid' },
        { name: 'tag3', indent: 'attribute', indentAttribute: 'src' },
      ],
    });
    expect(result.customTags).toHaveLength(3);
    expect(result.customTags![0].indent).toBe('never');
    expect(result.customTags![1].indent).toBeUndefined();
    expect(result.customTags![2].indent).toBe('attribute');
    expect(result.customTags![2].indentAttribute).toBe('src');
  });

  it('validates customTags display field', () => {
    const result = validateConfig({
      customTags: [
        { name: 'my-card', display: 'block' },
        { name: 'my-badge', display: 'inline-block' },
        { name: 'my-widget', display: 'invalid-display' },
      ],
    });
    expect(result.customTags).toHaveLength(3);
    expect(result.customTags![0].display).toBe('block');
    expect(result.customTags![1].display).toBe('inline-block');
    expect(result.customTags![2].display).toBeUndefined();
  });

  it('validates customTags children config', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-06/schema#',
      type: 'object',
    };
    const result = validateConfig({
      customTags: [
        {
          name: 'pl-multiple-choice',
          allowAdditionalChildren: true,
          children: [
            { name: 'pl-answer', schema },
            {
              name: 'pl-answer-feedback',
              children: [{ name: 'pl-markdown' }],
            },
            { name: '' },
            { noName: true },
          ],
        },
        {
          name: 'pl-order-blocks',
          allowAdditionalChildren: 'invalid',
          children: [{ name: 'pl-answer' }],
        },
      ],
    });

    expect(result.customTags).toHaveLength(2);
    expect(result.customTags![0].allowAdditionalChildren).toBe(true);
    expect(result.customTags![0].children).toHaveLength(2);
    expect(result.customTags![0].children?.[0]).toEqual({
      name: 'pl-answer',
      schema,
    });
    expect(result.customTags![0].children?.[1]).toEqual({
      name: 'pl-answer-feedback',
      children: [{ name: 'pl-markdown' }],
    });
    expect(result.customTags![1].allowAdditionalChildren).toBeUndefined();
    expect(result.customTags![1].children).toEqual([{ name: 'pl-answer' }]);
  });

  it('validates include array', () => {
    expect(validateConfig({ include: ['**/*.mustache', '**/*.hbs'] })).toEqual({
      include: ['**/*.mustache', '**/*.hbs'],
    });
  });

  it('filters invalid include entries', () => {
    const result = validateConfig({ include: ['**/*.mustache', '', 42, null, '**/*.hbs'] });
    expect(result.include).toEqual(['**/*.mustache', '**/*.hbs']);
  });

  it('omits include when all entries are invalid', () => {
    expect(validateConfig({ include: ['', 42, null] })).toEqual({});
  });

  it('ignores non-array include', () => {
    expect(validateConfig({ include: '**/*.mustache' })).toEqual({});
  });

  it('validates exclude array', () => {
    expect(validateConfig({ exclude: ['**/vendor/**'] })).toEqual({
      exclude: ['**/vendor/**'],
    });
  });

  it('filters invalid exclude entries', () => {
    const result = validateConfig({ exclude: ['**/vendor/**', '', 123] });
    expect(result.exclude).toEqual(['**/vendor/**']);
  });

  it('omits exclude when all entries are invalid', () => {
    expect(validateConfig({ exclude: [''] })).toEqual({});
  });

  it('ignores non-array exclude', () => {
    expect(validateConfig({ exclude: '**/vendor/**' })).toEqual({});
  });

  it('validates rules with known rule names and valid severities', () => {
    const result = validateConfig({
      rules: {
        preferMustacheComments: 'warning',
        unescapedEntities: 'off',
        duplicateAttributes: 'error',
      },
    });
    expect(result.rules).toEqual({
      preferMustacheComments: 'warning',
      unescapedEntities: 'off',
      duplicateAttributes: 'error',
    });
  });

  it('accepts syntactically valid plugin rule names', () => {
    const result = validateConfig({
      rules: {
        preferMustacheComments: 'warning',
        nonExistentRule: 'error',
      },
    });
    expect(result.rules).toEqual({
      preferMustacheComments: 'warning',
      nonExistentRule: 'error',
    });
  });

  it('ignores invalid rule severity values', () => {
    const result = validateConfig({
      rules: {
        preferMustacheComments: 'warn',
        unescapedEntities: true,
        duplicateAttributes: 'error',
      },
    });
    expect(result.rules).toEqual({ duplicateAttributes: 'error' });
  });

  it('accepts plugin rule names when all entries are syntactically valid', () => {
    const result = validateConfig({
      rules: {
        unknownRule: 'error',
        anotherUnknown: 'warning',
      },
    });
    expect(result.rules).toEqual({
      unknownRule: 'error',
      anotherUnknown: 'warning',
    });
  });

  it('ignores non-object rules', () => {
    expect(validateConfig({ rules: 'error' })).toEqual({});
    expect(validateConfig({ rules: ['error'] })).toEqual({});
  });

  it('accepts object-form rule entry with severity only', () => {
    const result = validateConfig({
      rules: {
        preferMustacheComments: { severity: 'warning' },
      },
    });
    expect(result.rules).toEqual({
      preferMustacheComments: { severity: 'warning' },
    });
  });

  it('rejects object-form rule entry with invalid severity', () => {
    const result = validateConfig({
      rules: {
        preferMustacheComments: { severity: 'warn' },
      },
    });
    expect(result.rules).toBeUndefined();
  });

  it('rejects object-form rule entry without severity', () => {
    const result = validateConfig({
      rules: {
        preferMustacheComments: { foo: 'bar' },
      },
    });
    expect(result.rules).toBeUndefined();
  });

  it('parses elementContentTooLong options', () => {
    const result = validateConfig({
      rules: {
        elementContentTooLong: {
          severity: 'warning',
          elements: [
            { tag: 'pl-question-panel', maxBytes: 2000 },
            { tag: 'pl-answer-panel', maxBytes: 3000 },
          ],
        },
      },
    });
    expect(result.rules).toEqual({
      elementContentTooLong: {
        severity: 'warning',
        elements: [
          { tag: 'pl-question-panel', maxBytes: 2000 },
          { tag: 'pl-answer-panel', maxBytes: 3000 },
        ],
      },
    });
  });

  it('filters out malformed element entries but keeps valid ones', () => {
    const result = validateConfig({
      rules: {
        elementContentTooLong: {
          severity: 'warning',
          elements: [
            { tag: 'pl-question-panel', maxBytes: 2000 },
            { tag: '', maxBytes: 100 },
            { tag: 'foo', maxBytes: -1 },
            { tag: 'bar', maxBytes: 'nope' },
            'not-an-object',
          ],
        },
      },
    });
    expect(result.rules).toEqual({
      elementContentTooLong: {
        severity: 'warning',
        elements: [{ tag: 'pl-question-panel', maxBytes: 2000 }],
      },
    });
  });

  it('still accepts string severity for elementContentTooLong', () => {
    const result = validateConfig({
      rules: {
        elementContentTooLong: 'off',
      },
    });
    expect(result.rules).toEqual({ elementContentTooLong: 'off' });
  });

  it('validates customRules with valid entries', () => {
    const result = validateConfig({
      customRules: [
        { id: 'no-font', selector: 'font', message: 'Deprecated element' },
        { id: 'no-inline', selector: '[style]', message: 'Avoid inline styles', severity: 'warning' },
      ],
    });
    expect(result.customRules).toHaveLength(2);
    expect(result.customRules![0]).toEqual({ id: 'no-font', selector: 'font', message: 'Deprecated element' });
    expect(result.customRules![1].severity).toBe('warning');
  });

  it('skips customRules entries missing id', () => {
    const result = validateConfig({
      customRules: [
        { selector: 'font', message: 'Missing id' },
        { id: 'ok', selector: 'div', message: 'Valid' },
      ],
    });
    expect(result.customRules).toHaveLength(1);
    expect(result.customRules![0].id).toBe('ok');
  });

  it('skips customRules entries with empty id', () => {
    const result = validateConfig({
      customRules: [{ id: '', selector: 'font', message: 'Empty id' }],
    });
    expect(result.customRules).toBeUndefined();
  });

  it('skips customRules entries missing selector', () => {
    const result = validateConfig({
      customRules: [{ id: 'x', message: 'No selector' }],
    });
    expect(result.customRules).toBeUndefined();
  });

  it('skips customRules entries missing message', () => {
    const result = validateConfig({
      customRules: [{ id: 'x', selector: 'div' }],
    });
    expect(result.customRules).toBeUndefined();
  });

  it('skips customRules entries with invalid severity', () => {
    const result = validateConfig({
      customRules: [{ id: 'x', selector: 'div', message: 'Test', severity: 'warn' }],
    });
    expect(result.customRules).toHaveLength(1);
    expect(result.customRules![0].severity).toBeUndefined();
  });

  it('omits customRules when all entries are invalid', () => {
    const result = validateConfig({
      customRules: [{ bad: true }, 'not-an-object', null],
    });
    expect(result.customRules).toBeUndefined();
  });

  it('ignores non-array customRules', () => {
    expect(validateConfig({ customRules: 'font' })).toEqual({});
  });

  it('parses customRules with per-rule include/exclude', () => {
    const result = validateConfig({
      customRules: [
        {
          id: 'no-font', selector: 'font', message: 'Deprecated',
          include: ['questions/**/*.mustache'],
          exclude: ['**/legacy/**'],
        },
      ],
    });
    expect(result.customRules![0].include).toEqual(['questions/**/*.mustache']);
    expect(result.customRules![0].exclude).toEqual(['**/legacy/**']);
  });

  it('drops empty / non-string entries in rule include/exclude', () => {
    const result = validateConfig({
      customRules: [
        {
          id: 'x', selector: 'div', message: 'm',
          include: ['keep/**', '', 42, null],
          exclude: [123, 'drop/**'],
        },
      ],
    });
    expect(result.customRules![0].include).toEqual(['keep/**']);
    expect(result.customRules![0].exclude).toEqual(['drop/**']);
  });

  it('omits rule include/exclude when all entries are invalid', () => {
    const result = validateConfig({
      customRules: [
        { id: 'x', selector: 'div', message: 'm', include: ['', 42], exclude: [null] },
      ],
    });
    expect(result.customRules![0].include).toBeUndefined();
    expect(result.customRules![0].exclude).toBeUndefined();
  });
});

describe('findConfigFile', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'configfile-test-'));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('finds config file in same directory', () => {
    const configPath = path.join(tempDir, '.htmlmustache.jsonc');
    fs.writeFileSync(configPath, '{}');
    expect(findConfigFile(tempDir)).toBe(configPath);
  });

  it('finds config file in parent directory', () => {
    const subDir = path.join(tempDir, 'sub');
    fs.mkdirSync(subDir, { recursive: true });
    // Config file was created in tempDir in the previous test
    expect(findConfigFile(subDir)).toBe(path.join(tempDir, '.htmlmustache.jsonc'));
  });

  it('returns null when no config file exists', () => {
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'no-config-'));
    try {
      expect(findConfigFile(isolated)).toBeNull();
    } finally {
      fs.rmSync(isolated, { recursive: true, force: true });
    }
  });
});

describe('loadConfigFile', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadconfig-test-'));
    fs.writeFileSync(
      path.join(tempDir, '.htmlmustache.jsonc'),
      `{
        // My config
        "printWidth": 120,
        "mustacheSpaces": true,
      }`
    );
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads config from file:// URI', async () => {
    const uri = pathToFileURL(path.join(tempDir, 'test.mustache')).href;
    const loaded = await loadConfigFile(uri);
    expect(loaded).not.toBeNull();
    expect(loaded!.config.printWidth).toBe(120);
    expect(loaded!.config.mustacheSpaces).toBe(true);
    expect(loaded!.configDir).toBe(tempDir);
  });

  it('returns null for non-file URI', async () => {
    expect(await loadConfigFile('untitled:Untitled-1')).toBeNull();
  });
});

describe('loadConfigFileForPath', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadconfigpath-test-'));
    fs.writeFileSync(
      path.join(tempDir, '.htmlmustache.jsonc'),
      `{ "indentSize": 8 }`
    );
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads config for a file path', async () => {
    const loaded = await loadConfigFileForPath(path.join(tempDir, 'test.mustache'));
    expect(loaded).not.toBeNull();
    expect(loaded!.config.indentSize).toBe(8);
    expect(loaded!.configDir).toBe(tempDir);
  });

  it('returns null when no config exists', async () => {
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'no-config-path-'));
    try {
      expect(await loadConfigFileForPath(path.join(isolated, 'test.mustache'))).toBeNull();
    } finally {
      fs.rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('loads a pluginModule referenced from the config', async () => {
    const fmTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-fm-'));
    try {
      fs.writeFileSync(
        path.join(fmTempDir, 'htmlmustache-plugin.mjs'),
        'export const formats = { "pl-boolean": (v) => typeof v === "string" && /^(true|false)$/i.test(v) };',
      );
      fs.writeFileSync(
        path.join(fmTempDir, 'pl-card.schema.json'),
        JSON.stringify({
          $schema: 'http://json-schema.org/draft-06/schema#',
          type: 'object',
          properties: {
            live: { type: 'string', format: 'pl-boolean' },
          },
          required: ['live'],
        }),
      );
      fs.writeFileSync(
        path.join(fmTempDir, '.htmlmustache.jsonc'),
        JSON.stringify({
          pluginModule: './htmlmustache-plugin.mjs',
          customTags: [{ name: 'pl-card', schema: './pl-card.schema.json' }],
        }),
      );
      const loaded = await loadConfigFileForPath(path.join(fmTempDir, 'test.mustache'));
      expect(loaded).not.toBeNull();
      expect(loaded!.schemaLoadErrors).toEqual([]);
      const compiled = loaded!.schemaRegistry.schemas.get('pl-card')!;
      expect(compiled).toBeDefined();
      expect(
        compiled.validate({
          live: 'True',
        }),
      ).toBe(true);
      expect(
        compiled.validate({
          live: 'maybe',
        }),
      ).toBe(false);
    } finally {
      fs.rmSync(fmTempDir, { recursive: true, force: true });
    }
  });

  it('loads child schemas referenced from customTags children', async () => {
    const fmTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-child-schema-'));
    try {
      fs.writeFileSync(
        path.join(fmTempDir, 'pl-answer.schema.json'),
        JSON.stringify({
          $schema: 'http://json-schema.org/draft-06/schema#',
          type: 'object',
          properties: {
            correct: { type: 'boolean' },
          },
          additionalProperties: false,
        }),
      );
      fs.writeFileSync(
        path.join(fmTempDir, '.htmlmustache.jsonc'),
        JSON.stringify({
          customTags: [
            {
              name: 'pl-multiple-choice',
              children: [
                {
                  name: 'pl-answer',
                  schema: './pl-answer.schema.json',
                  children: [{ name: 'pl-answer-feedback' }],
                },
              ],
            },
            { name: 'pl-answer' },
          ],
        }),
      );

      const loaded = await loadConfigFileForPath(path.join(fmTempDir, 'test.mustache'));
      expect(loaded).not.toBeNull();
      expect(loaded!.schemaLoadErrors).toEqual([]);
      const childConfig = loaded!.schemaRegistry.children.get('pl-multiple-choice');
      expect(childConfig?.allowAdditionalChildren).toBe(false);
      const childEntry = childConfig?.tags.get('pl-answer');
      const compiled = childEntry?.schema;
      expect(compiled).toBeDefined();
      expect(compiled!.validate({ correct: true })).toBe(true);
      expect(compiled!.validate({ ranking: '1' })).toBe(false);
      expect(childEntry?.children?.tags.has('pl-answer-feedback')).toBe(true);
      expect(loaded!.schemaRegistry.childParents.get('pl-answer-feedback')).toEqual(
        new Set(['pl-answer']),
      );
    } finally {
      fs.rmSync(fmTempDir, { recursive: true, force: true });
    }
  });
});
