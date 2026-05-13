import { describe, it, expect, beforeAll } from 'vitest';
import { CompletionItemKind, InsertTextFormat } from 'vscode-languageserver/node';
import { parseText, createMockDocument } from './setup.js';
import { getCompletions } from '../src/completion.js';
import { loadSchemaRegistry } from '../../../js/shared/customTagSchemaLoader.js';
import type { SchemaRegistry } from '../../../js/shared/customTagSchemaLoader.js';

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

const PL_MC_SCHEMA = {
  $schema: DRAFT,
  type: 'object',
  properties: {
    tag: { const: 'pl-multiple-choice' },
    attributes: {
      type: 'object',
      properties: {
        'answers-name': { type: 'string' },
        weight: { type: 'string', format: 'pl-integer' },
        order: { enum: ['random', 'ascend', 'descend', 'fixed'] },
        display: { enum: ['block', 'inline', 'dropdown'] },
        'fixed-order': {
          anyOf: [
            { type: 'boolean' },
            { type: 'string', format: 'pl-boolean', examples: ['true', 'false'] },
          ],
        },
      },
      required: ['answers-name'],
      additionalProperties: false,
    },
  },
  required: ['attributes'],
} as const;

let registry: SchemaRegistry;

beforeAll(() => {
  const { registry: r, loadErrors } = loadSchemaRegistry([
    { name: 'pl-multiple-choice', schema: PL_MC_SCHEMA },
  ]);
  expect(loadErrors).toEqual([]);
  registry = r;
});

function complete(content: string, line: number, character: number) {
  const tree = parseText(content);
  const document = createMockDocument(content);
  return getCompletions(
    tree,
    document,
    {
      textDocument: { uri: document.uri },
      position: { line, character },
    },
    registry,
  );
}

describe('Completion — attribute names', () => {
  it('offers every property when none are present', () => {
    // Cursor in the attribute slot before the closing '>'.
    const src = '<pl-multiple-choice ></pl-multiple-choice>';
    const items = complete(src, 0, 20);
    const labels = items.map((i) => i.label).sort();
    expect(labels).toEqual([
      'answers-name',
      'display',
      'fixed-order',
      'order',
      'weight',
    ]);
  });

  it('marks required attributes with preselect + (required) detail', () => {
    const src = '<pl-multiple-choice ></pl-multiple-choice>';
    const items = complete(src, 0, 20);
    const required = items.find((i) => i.label === 'answers-name');
    expect(required?.preselect).toBe(true);
    expect(required?.detail).toContain('(required)');
    expect(required?.kind).toBe(CompletionItemKind.Property);
  });

  it('surfaces format hint in detail for format-typed attrs', () => {
    const src = '<pl-multiple-choice ></pl-multiple-choice>';
    const items = complete(src, 0, 20);
    const weight = items.find((i) => i.label === 'weight');
    expect(weight?.detail).toContain('format: pl-integer');
  });

  it('inserts a snippet with the cursor inside the quoted value', () => {
    const src = '<pl-multiple-choice ></pl-multiple-choice>';
    const items = complete(src, 0, 20);
    const order = items.find((i) => i.label === 'order');
    expect(order?.insertText).toBe('order="$1"');
    expect(order?.insertTextFormat).toBe(InsertTextFormat.Snippet);
  });

  it('filters out attributes that are already present', () => {
    const src =
      '<pl-multiple-choice answers-name="x" ></pl-multiple-choice>';
    // Cursor right after the space after answers-name="x".
    const items = complete(src, 0, 37);
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain('answers-name');
    expect(labels).toContain('order');
  });
});

describe('Completion — attribute values', () => {
  it('offers enum values inside a quoted value', () => {
    const src = '<pl-multiple-choice order=""></pl-multiple-choice>';
    // Cursor between the quotes.
    const items = complete(src, 0, 27);
    const values = items.map((i) => i.label);
    expect(values).toEqual(['random', 'ascend', 'descend', 'fixed']);
    expect(items.every((i) => i.kind === CompletionItemKind.EnumMember)).toBe(
      true,
    );
  });

  it('unions boolean type and examples without duplicates', () => {
    const src =
      '<pl-multiple-choice fixed-order=""></pl-multiple-choice>';
    // Cursor between the quotes.
    const items = complete(src, 0, 33);
    expect(items.map((i) => i.label)).toEqual(['true', 'false']);
  });

  it('returns no value items for format-only attributes', () => {
    const src = '<pl-multiple-choice weight=""></pl-multiple-choice>';
    // Cursor between the quotes.
    const items = complete(src, 0, 28);
    expect(items).toEqual([]);
  });
});

describe('Completion — guards', () => {
  it('returns empty list for tags without a schema', () => {
    const src = '<unknown-tag ></unknown-tag>';
    const items = complete(src, 0, 13);
    expect(items).toEqual([]);
  });

  it('returns empty list when registry is undefined', () => {
    const src = '<pl-multiple-choice ></pl-multiple-choice>';
    const tree = parseText(src);
    const document = createMockDocument(src);
    const items = getCompletions(
      tree,
      document,
      {
        textDocument: { uri: document.uri },
        position: { line: 0, character: 20 },
      },
      undefined,
    );
    expect(items).toEqual([]);
  });
});
