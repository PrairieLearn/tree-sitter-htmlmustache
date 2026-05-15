import type { RuleSeverity } from './configSchema.js';

export type AttributeValue = string | true;

export type AttributeValueFor<TAllowBooleanAttributes extends boolean> =
  TAllowBooleanAttributes extends false ? string : AttributeValue;

export interface TagElement<TAllowBooleanAttributes extends boolean = true> {
  readonly tag: string;
  readonly attributes: Readonly<
    Record<string, AttributeValueFor<TAllowBooleanAttributes>>
  >;
  readonly children: readonly TagElement<TAllowBooleanAttributes>[];
  readonly innerHtml?: string;
  hasAttribute(name: string): boolean;
  getAttribute(
    name: string,
  ): AttributeValueFor<TAllowBooleanAttributes> | undefined;
  getLiteralAttribute(
    name: string,
  ): AttributeValueFor<TAllowBooleanAttributes> | undefined;
  isAttributeDynamic(name: string): boolean;
  childrenWithTag(tag: string): readonly TagElement<TAllowBooleanAttributes>[];
  childrenWithoutTag(
    tag: string,
  ): readonly TagElement<TAllowBooleanAttributes>[];
}

export interface ValidatorContext {
  report(diagnostic: {
    element: TagElement;
    attribute?: string;
    message: string;
  }): void;
  reportElement(element: TagElement, message: string): void;
  reportAttribute(
    element: TagElement,
    attribute: string,
    message: string,
  ): void;
}

export interface TagValidator {
  id: string;
  tags: string[];
  severity?: RuleSeverity;
  options?: {
    includeInnerHtml?: boolean;
  };
  validate(element: TagElement, context: ValidatorContext): void;
}

export type TagValidatorFn<TAllowBooleanAttributes extends boolean = true> = (
  element: TagElement<TAllowBooleanAttributes>,
  context: ValidatorContext,
) => void;

export interface TagValidatorRule<
  TAllowBooleanAttributes extends boolean = true,
> {
  severity?: RuleSeverity;
  options?: TagValidator['options'];
  validate: TagValidatorFn<TAllowBooleanAttributes>;
}

export type TagValidatorRuleEntry<
  TAllowBooleanAttributes extends boolean = true,
> =
  | TagValidatorFn<TAllowBooleanAttributes>
  | TagValidatorRule<TAllowBooleanAttributes>;

function normalizeTagInput(tag: string): string {
  if (tag.length === 0) {
    throw new TypeError('Tag validator tags must be non-empty strings.');
  }
  return tag.toLowerCase();
}

export function defineTagValidators<
  TAllowBooleanAttributes extends boolean = true,
>(
  tagOrTags: string | readonly string[],
  rules: Readonly<
    Record<string, TagValidatorRuleEntry<TAllowBooleanAttributes>>
  >,
): TagValidator[] {
  const tags = (Array.isArray(tagOrTags) ? tagOrTags : [tagOrTags]).map(
    normalizeTagInput,
  );
  if (tags.length === 0) {
    throw new TypeError('defineTagValidators requires at least one tag.');
  }

  return Object.entries(rules).map(([id, rule]) => {
    if (typeof rule === 'function') {
      return {
        id,
        tags: [...tags],
        validate: rule as TagValidator['validate'],
      };
    }
    return {
      id,
      tags: [...tags],
      ...(rule.severity !== undefined ? { severity: rule.severity } : {}),
      ...(rule.options !== undefined ? { options: rule.options } : {}),
      validate: rule.validate as TagValidator['validate'],
    };
  });
}

export function isSyntacticRuleId(id: string): boolean {
  return id.length > 0 && !/[\s,]/.test(id);
}
