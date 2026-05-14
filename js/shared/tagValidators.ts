import type { RuleSeverity } from './configSchema.js';

export interface TagElement {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string | true>>;
  readonly children: readonly TagElement[];
  readonly innerHtml?: string;
  hasDynamicAttribute(name: string): boolean;
}

export interface ValidatorContext {
  report(diagnostic: {
    element: TagElement;
    attribute?: string;
    message: string;
  }): void;
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

export function isSyntacticRuleId(id: string): boolean {
  return id.length > 0 && !/[\s,]/.test(id);
}
