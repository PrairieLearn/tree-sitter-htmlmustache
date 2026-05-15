import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { htmlMustacheConfigSchema } from './configSchema.js';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');
const CONFIG_SCHEMA_PATH = path.join(
  REPO_ROOT,
  'schemas',
  'htmlmustache-config.schema.json',
);

function compileConfigSchema() {
  const schema = JSON.parse(readFileSync(CONFIG_SCHEMA_PATH, 'utf8')) as object;
  const ajv = new Ajv({ strict: true });
  return ajv.compile(schema);
}

function generatedConfigSchema(): unknown {
  const schema = z.toJSONSchema(htmlMustacheConfigSchema, {
    target: 'draft-7',
  });
  schema.$id =
    'https://raw.githubusercontent.com/reteps/tree-sitter-htmlmustache/main/schemas/htmlmustache-config.schema.json';
  schema.title = 'HTML Mustache configuration';
  schema.description = 'Configuration for .htmlmustache.jsonc files.';
  return schema;
}

describe('htmlmustache config JSON Schema', () => {
  it('stays in sync with the Zod config schema source', () => {
    const schema = JSON.parse(readFileSync(CONFIG_SCHEMA_PATH, 'utf8'));

    expect(schema).toEqual(generatedConfigSchema());
  });

  it('validates a representative .htmlmustache.jsonc config shape', () => {
    const validate = compileConfigSchema();

    expect(
      validate({
        $schema:
          'https://raw.githubusercontent.com/reteps/tree-sitter-htmlmustache/main/schemas/htmlmustache-config.schema.json',
        include: ['**/*.mustache', '**/*.hbs'],
        exclude: ['**/vendor/**'],
        printWidth: 100,
        indentSize: 2,
        mustacheSpaces: true,
        noBreakDelimiters: [{ start: '$', end: '$' }],
        pluginModule: './scripts/htmlmustache-plugin.mjs',
        customTagDefaults: {
          allowBooleanAttributes: false,
        },
        customTags: [
          {
            name: 'pl-multiple-choice',
            allowBooleanAttributes: true,
            display: 'block',
            languageDefault: 'html',
            languageAttribute: 'language',
            languageMap: { python3: 'python' },
            indent: 'attribute',
            indentAttribute: 'source-file-name',
            schema: {
              $schema: 'http://json-schema.org/draft-06/schema#',
              type: 'object',
              properties: {
                'answers-name': { type: 'string' },
              },
              required: ['answers-name'],
              additionalProperties: false,
            },
            children: [
              {
                name: 'pl-answer',
                allowBooleanAttributes: false,
                schema: 'elements/pl-answer.schema.json',
                children: [{ name: 'pl-answer-feedback' }],
              },
            ],
            allowAdditionalChildren: true,
          },
        ],
        rules: {
          preferMustacheComments: 'warning',
          elementContentTooLong: {
            severity: 'error',
            elements: [{ tag: 'pl-question-panel', maxBytes: 2000 }],
          },
          projectSpecificRule: { severity: 'warning' },
        },
        customRules: [
          {
            id: 'no-font',
            selector: 'font',
            message: 'Avoid deprecated elements',
            severity: 'warning',
            include: ['questions/**/*.mustache'],
            exclude: ['**/legacy/**'],
          },
        ],
      }),
    ).toBe(true);
  });

  it('rejects non-boolean custom tag boolean-attribute options', () => {
    const validate = compileConfigSchema();

    expect(
      validate({
        customTagDefaults: { allowBooleanAttributes: 'no' },
      }),
    ).toBe(false);

    expect(
      validate({
        customTags: [{ name: 'pl-card', allowBooleanAttributes: 'no' }],
      }),
    ).toBe(false);
  });

  it('rejects misspelled top-level keys', () => {
    const validate = compileConfigSchema();

    expect(validate({ printwidth: 100 })).toBe(false);
  });

  it('rejects invalid severities and malformed rule options', () => {
    const validate = compileConfigSchema();

    expect(
      validate({
        rules: {
          preferMustacheComments: 'warn',
        },
      }),
    ).toBe(false);

    expect(
      validate({
        rules: {
          elementContentTooLong: {
            severity: 'warning',
            elements: [{ tag: 'pl-question-panel', maxBytes: -1 }],
          },
        },
      }),
    ).toBe(false);
  });
});
