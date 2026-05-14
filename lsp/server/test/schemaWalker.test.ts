import { describe, it, expect } from 'vitest';
import {
  collectAttributeNames,
  collectAttributeValues,
  type JSONSchema,
} from '../src/schemaWalker.js';

const DRAFT = 'http://json-schema.org/draft-06/schema#';

function attrSchema(properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema {
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

function rootWith(attributes: JSONSchema, extras: Partial<JSONSchema> = {}): JSONSchema {
  return {
    $schema: DRAFT,
    type: 'object',
    properties: attributes.properties,
    required: attributes.required,
    additionalProperties: attributes.additionalProperties,
    ...extras,
  };
}

describe('collectAttributeNames', () => {
  it('returns top-level properties with required flag', () => {
    const schema = rootWith(
      attrSchema(
        {
          'answers-name': { type: 'string' },
          weight: { type: 'string' },
        },
        ['answers-name'],
      ),
    );
    const attrs = collectAttributeNames(schema);
    expect(attrs.map((a) => a.name).sort()).toEqual(['answers-name', 'weight']);
    expect(attrs.find((a) => a.name === 'answers-name')?.required).toBe(true);
    expect(attrs.find((a) => a.name === 'weight')?.required).toBe(false);
  });

  it('unions properties from allOf branches', () => {
    const schema = rootWith(attrSchema({ a: { type: 'string' } }), {
      allOf: [
        {
          properties: { b: { type: 'string' } },
        },
      ],
    });
    const names = collectAttributeNames(schema)
      .map((a) => a.name)
      .sort();
    expect(names).toEqual(['a', 'b']);
  });

  it('surfaces conditional properties from if/then without marking required', () => {
    const schema = rootWith(attrSchema({ size: { type: 'string' } }), {
      allOf: [
        {
          if: { required: ['size'] },
          then: {
            properties: { display: { const: 'dropdown' } },
            required: ['display'],
          },
        },
      ],
    });
    const attrs = collectAttributeNames(schema);
    const names = attrs.map((a) => a.name).sort();
    expect(names).toEqual(['display', 'size']);
    // 'display' is only required when 'size' is present — don't surface it as
    // unconditionally required.
    expect(attrs.find((a) => a.name === 'display')?.required).toBe(false);
  });

  it('deduplicates a property across branches (first description wins)', () => {
    const schema = rootWith(attrSchema({ display: { enum: ['a', 'b'] } }), {
      allOf: [
        {
          properties: { display: { enum: ['z'] } },
        },
      ],
    });
    const attrs = collectAttributeNames(schema);
    expect(attrs).toHaveLength(1);
    expect((attrs[0].schema as JSONSchema).enum).toEqual(['a', 'b']);
  });

  it('returns empty when schema has no attributes', () => {
    const schema: JSONSchema = { $schema: DRAFT, type: 'object', properties: {} };
    expect(collectAttributeNames(schema)).toEqual([]);
  });
});

describe('collectAttributeValues', () => {
  it('returns enum values', () => {
    const result = collectAttributeValues({ enum: ['random', 'fixed'] });
    expect(result.values.map((v) => v.value)).toEqual(['random', 'fixed']);
    expect(result.values.every((v) => v.kind === 'enum')).toBe(true);
  });

  it('returns const value', () => {
    const result = collectAttributeValues({ const: 'dropdown' });
    expect(result.values).toEqual([{ value: 'dropdown', kind: 'const' }]);
  });

  it('returns examples', () => {
    const result = collectAttributeValues({ examples: ['true', 'false'] });
    expect(result.values).toEqual([
      { value: 'true', kind: 'example' },
      { value: 'false', kind: 'example' },
    ]);
  });

  it('returns default', () => {
    const result = collectAttributeValues({ default: 'block' });
    expect(result.values).toEqual([{ value: 'block', kind: 'default' }]);
  });

  it('expands type: boolean to true/false', () => {
    const result = collectAttributeValues({ type: 'boolean' });
    expect(result.values).toEqual([
      { value: 'true', kind: 'boolean' },
      { value: 'false', kind: 'boolean' },
    ]);
  });

  it('unions values across anyOf branches and dedupes', () => {
    const result = collectAttributeValues({
      anyOf: [
        { type: 'boolean' },
        { type: 'string', format: 'pl-boolean', examples: ['true', 'yes'] },
      ],
    });
    const values = result.values.map((v) => v.value);
    // 'true' and 'false' come from boolean; 'yes' from examples; 'true' is
    // not duplicated.
    expect(values).toEqual(['true', 'false', 'yes']);
    expect(result.formats).toEqual(['pl-boolean']);
  });

  it('surfaces formats without inventing values for them', () => {
    const result = collectAttributeValues({ type: 'string', format: 'pl-integer' });
    expect(result.values).toEqual([]);
    expect(result.formats).toEqual(['pl-integer']);
  });

  it('returns empty result for a plain string schema', () => {
    const result = collectAttributeValues({ type: 'string' });
    expect(result.values).toEqual([]);
    expect(result.formats).toEqual([]);
  });
});
