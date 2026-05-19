import type {
  AttributeValueFor,
  TagElement,
  ValidatorContext,
} from './tagValidators.js';

interface AttributeLookup<TAllowBooleanAttributes extends boolean = true> {
  hasAttribute(name: string): boolean;
  getLiteralAttribute(
    name: string,
  ): AttributeValueFor<TAllowBooleanAttributes> | undefined;
}

const attributeLookups = new WeakMap<
  TagElement<boolean>,
  AttributeLookup<boolean>
>();

export function registerTagElementAttributes(
  element: TagElement<boolean>,
  lookup: AttributeLookup<boolean>,
): void {
  attributeLookups.set(element, lookup);
}

export interface AttributeHelper<
  TAllowBooleanAttributes extends boolean = true,
> {
  readonly name: string;
  present(): boolean;
  literal(): AttributeValueFor<TAllowBooleanAttributes> | undefined;
  literalMap<TValue>(
    mapper: (
      value: AttributeValueFor<TAllowBooleanAttributes>,
    ) => TValue | undefined,
  ): TValue | undefined;
}

export function attr<TAllowBooleanAttributes extends boolean = true>(
  element: TagElement<TAllowBooleanAttributes>,
  name: string,
): AttributeHelper<TAllowBooleanAttributes> {
  const normalized = name.toLowerCase();
  const lookup =
    (attributeLookups.get(element) as
      | AttributeLookup<TAllowBooleanAttributes>
      | undefined) ?? fallbackLookup(element);

  const literal = (): AttributeValueFor<TAllowBooleanAttributes> | undefined =>
    lookup.getLiteralAttribute(normalized);

  return {
    name,
    present(): boolean {
      return lookup.hasAttribute(normalized);
    },
    literal,
    literalMap<TValue>(
      mapper: (
        value: AttributeValueFor<TAllowBooleanAttributes>,
      ) => TValue | undefined,
    ): TValue | undefined {
      const value = literal();
      return value === undefined ? undefined : mapper(value);
    },
  };
}

export interface ElementValidationOptions<
  TAllowBooleanAttributes extends boolean = true,
> {
  reportAttribute?: string;
  invalid(element: TagElement<TAllowBooleanAttributes>): boolean;
  message: string | ((element: TagElement<TAllowBooleanAttributes>) => string);
}

export function validateElement<TAllowBooleanAttributes extends boolean = true>(
  context: ValidatorContext,
  element: TagElement<TAllowBooleanAttributes>,
  options: ElementValidationOptions<TAllowBooleanAttributes>,
): void {
  if (!options.invalid(element)) return;
  const message =
    typeof options.message === 'function'
      ? options.message(element)
      : options.message;
  if (options.reportAttribute) {
    context.reportAttribute(element, options.reportAttribute, message);
  } else {
    context.reportElement(element, message);
  }
}

export interface AttributeValidationOptions<
  TAllowBooleanAttributes extends boolean = true,
> {
  invalid(
    element: TagElement<TAllowBooleanAttributes>,
    attribute: AttributeHelper<TAllowBooleanAttributes>,
  ): boolean;
  message:
    | string
    | ((
        element: TagElement<TAllowBooleanAttributes>,
        attribute: AttributeHelper<TAllowBooleanAttributes>,
      ) => string);
}

export function validateAttributes<
  TAllowBooleanAttributes extends boolean = true,
>(
  context: ValidatorContext,
  element: TagElement<TAllowBooleanAttributes>,
  attributes: readonly string[],
  options: AttributeValidationOptions<TAllowBooleanAttributes>,
): void {
  for (const name of attributes) {
    const attribute = attr(element, name);
    if (!options.invalid(element, attribute)) continue;
    const message =
      typeof options.message === 'function'
        ? options.message(element, attribute)
        : options.message;
    context.reportAttribute(element, attribute.name, message);
  }
}

function fallbackLookup<TAllowBooleanAttributes extends boolean>(
  element: TagElement<TAllowBooleanAttributes>,
): AttributeLookup<TAllowBooleanAttributes> {
  return {
    hasAttribute(name: string): boolean {
      return Object.prototype.hasOwnProperty.call(element.attributes, name);
    },
    getLiteralAttribute(
      name: string,
    ): AttributeValueFor<TAllowBooleanAttributes> | undefined {
      return element.attributes[name];
    },
  };
}
