import { describe, expectTypeOf, it } from 'vitest';
import { defineTagValidators } from './tagValidators.js';
import type { TagElement } from './tagValidators.js';
import type { AttributeValue, AttributeValueFor } from '../linter/index.js';

describe('TagElement boolean attribute type narrowing', () => {
  it('keeps boolean attributes in the default public shape', () => {
    expectTypeOf<TagElement['attributes']['correct']>().toEqualTypeOf<
      string | true
    >();
    expectTypeOf<ReturnType<TagElement['getAttribute']>>().toEqualTypeOf<
      string | true | undefined
    >();
    expectTypeOf<ReturnType<TagElement['getLiteralAttribute']>>().toEqualTypeOf<
      string | true | undefined
    >();
  });

  it('narrows attributes to strings when boolean attributes are disabled', () => {
    expectTypeOf<
      TagElement<false>['attributes']['correct']
    >().toEqualTypeOf<string>();
    expectTypeOf<ReturnType<TagElement<false>['getAttribute']>>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<
      ReturnType<TagElement<false>['getLiteralAttribute']>
    >().toEqualTypeOf<string | undefined>();
    expectTypeOf<TagElement<false>['children'][number]>().toEqualTypeOf<
      TagElement<false>
    >();
    expectTypeOf<
      ReturnType<TagElement<false>['childrenWithTag']>[number]
    >().toEqualTypeOf<TagElement<false>>();
    expectTypeOf<
      ReturnType<TagElement<false>['childrenWithoutTag']>[number]
    >().toEqualTypeOf<TagElement<false>>();
  });

  it('allows validators to opt into the narrowed tag element shape', () => {
    defineTagValidators('pl-answer', {
      direct(element: TagElement<false>) {
        expectTypeOf(element.getAttribute('correct')).toEqualTypeOf<
          string | undefined
        >();
      },
      object: {
        validate(element: TagElement<false>) {
          expectTypeOf(element.getLiteralAttribute('correct')).toEqualTypeOf<
            string | undefined
          >();
        },
      },
    });
  });

  it('exports attribute value helper types from the public linter entry', () => {
    expectTypeOf<AttributeValue>().toEqualTypeOf<string | true>();
    expectTypeOf<AttributeValueFor<true>>().toEqualTypeOf<string | true>();
    expectTypeOf<AttributeValueFor<false>>().toEqualTypeOf<string>();
  });
});
