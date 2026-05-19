import { describe, expectTypeOf, it } from 'vitest';
import { attr } from './tagValidatorHelpers.js';
import { defineTagValidators } from './tagValidators.js';
import type { TagElement } from './tagValidators.js';
import type {
  AttributeHelper,
  AttributeValue,
  AttributeValueFor,
} from '../linter/index.js';

function testElement<TAllowBooleanAttributes extends boolean>(
  attributes: Record<string, AttributeValueFor<TAllowBooleanAttributes>>,
): TagElement<TAllowBooleanAttributes> {
  return {
    tag: 'pl-answer',
    attributes,
    children: [],
    childrenWithTag: () => [],
    childrenWithoutTag: () => [],
  };
}

describe('TagElement boolean attribute type narrowing', () => {
  it('keeps boolean attributes in the default public shape', () => {
    expectTypeOf<TagElement['attributes']['correct']>().toEqualTypeOf<
      string | true
    >();
    const element = testElement<true>({});
    expectTypeOf(attr(element, 'correct').literal()).toEqualTypeOf<
      string | true | undefined
    >();
    expectTypeOf(
      attr(element, 'correct').literalMap((value) =>
        value === true ? true : undefined,
      ),
    ).toEqualTypeOf<true | undefined>();
  });

  it('narrows attributes to strings when boolean attributes are disabled', () => {
    expectTypeOf<
      TagElement<false>['attributes']['correct']
    >().toEqualTypeOf<string>();
    expectTypeOf<TagElement<false>['children'][number]>().toEqualTypeOf<
      TagElement<false>
    >();
    expectTypeOf<
      ReturnType<TagElement<false>['childrenWithTag']>[number]
    >().toEqualTypeOf<TagElement<false>>();
    expectTypeOf<
      ReturnType<TagElement<false>['childrenWithoutTag']>[number]
    >().toEqualTypeOf<TagElement<false>>();
    const element = testElement<false>({});
    expectTypeOf(attr(element, 'correct').literal()).toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf(
      attr(element, 'correct').literalMap((value) => {
        expectTypeOf(value).toEqualTypeOf<string>();
        return value.length;
      }),
    ).toEqualTypeOf<number | undefined>();
  });

  it('allows validators to opt into the narrowed tag element shape', () => {
    defineTagValidators('pl-answer', {
      direct(element: TagElement<false>) {
        expectTypeOf(attr(element, 'correct').literal()).toEqualTypeOf<
          string | undefined
        >();
      },
      object: {
        validate(element: TagElement<false>) {
          expectTypeOf(attr(element, 'correct').literal()).toEqualTypeOf<
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
    expectTypeOf<AttributeHelper<false>['literal']>().returns.toEqualTypeOf<
      string | undefined
    >();
  });
});
