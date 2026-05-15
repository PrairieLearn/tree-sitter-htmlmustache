import { describe, expectTypeOf, it } from 'vitest';
import type { TagElement } from './tagValidators.js';

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
  });
});
