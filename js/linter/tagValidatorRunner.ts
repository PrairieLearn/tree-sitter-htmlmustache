import type { BalanceNode } from './htmlBalanceChecker.js';
import type { CheckError } from './collectErrors.js';
import type { RuleSeverity, RulesConfig } from '../shared/configSchema.js';
import type { TagElement, TagValidator } from '../shared/tagValidators.js';
import {
  getTagName,
  isHtmlElementType,
  isMustacheSection,
} from '../shared/nodeHelpers.js';

interface AttributeInfo {
  attrNode: BalanceNode;
  valueNode: BalanceNode | null;
  value: string | true;
  dynamic: boolean;
}

interface Facade extends TagElement {
  readonly node: BalanceNode;
  readonly startTag: BalanceNode;
  readonly attributesByName: ReadonlyMap<string, AttributeInfo>;
}

function findStartTag(node: BalanceNode): BalanceNode | null {
  return (
    node.children.find(
      (c) => c.type === 'html_start_tag' || c.type === 'html_self_closing_tag',
    ) ?? null
  );
}

function findEndTag(node: BalanceNode): BalanceNode | null {
  return (
    node.children.find(
      (c) => c.type === 'html_end_tag' || c.type === 'html_forced_end_tag',
    ) ?? null
  );
}

function stripQuotes(text: string): string {
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function containsMustache(node: BalanceNode | null): boolean {
  if (!node) return false;
  if (node.type.startsWith('mustache_')) return true;
  return node.children.some(containsMustache);
}

function readAttributes(startTag: BalanceNode): Map<string, AttributeInfo> {
  const attributes = new Map<string, AttributeInfo>();
  for (const child of startTag.children) {
    if (child.type !== 'html_attribute') continue;
    const nameNode = child.children.find(
      (c) => c.type === 'html_attribute_name',
    );
    if (!nameNode) continue;
    const valueNode =
      child.children.find(
        (c) =>
          c.type === 'html_attribute_value' ||
          c.type === 'html_quoted_attribute_value',
      ) ?? null;
    attributes.set(nameNode.text.toLowerCase(), {
      attrNode: child,
      valueNode,
      value: valueNode ? stripQuotes(valueNode.text) : true,
      dynamic: containsMustache(child),
    });
  }
  return attributes;
}

function buildElementInnerHtml(element: BalanceNode): string {
  const startTag = findStartTag(element);
  if (!startTag || startTag.type === 'html_self_closing_tag') return '';
  const endTag = findEndTag(element);
  const innerStart = startTag.endIndex - element.startIndex;
  const innerEnd = endTag
    ? endTag.startIndex - element.startIndex
    : element.text.length;
  if (innerEnd <= innerStart) return '';
  return element.text.slice(innerStart, innerEnd);
}

function collectDirectHtmlChildren(
  node: BalanceNode,
  out: BalanceNode[] = [],
): BalanceNode[] {
  for (const child of node.children) {
    if (isHtmlElementType(child)) {
      out.push(child);
    } else if (isMustacheSection(child)) {
      collectDirectHtmlChildren(child, out);
    }
  }
  return out;
}

function buildFacade(
  node: BalanceNode,
  includeInnerHtml: boolean,
  includeChildren: boolean,
): Facade | null {
  const tag = getTagName(node)?.toLowerCase();
  const startTag = findStartTag(node);
  if (!tag || !startTag) return null;
  const attributesByName = readAttributes(startTag);
  const attributes: Record<string, string | true> = {};
  for (const [name, info] of attributesByName) attributes[name] = info.value;
  const children = includeChildren
    ? collectDirectHtmlChildren(node)
        .map((child) => buildFacade(child, includeInnerHtml, true))
        .filter((child): child is Facade => child !== null)
    : [];
  return {
    tag,
    attributes,
    children,
    ...(includeInnerHtml ? { innerHtml: buildElementInnerHtml(node) } : {}),
    node,
    startTag,
    attributesByName,
    hasAttribute(name: string): boolean {
      return attributesByName.has(name.toLowerCase());
    },
    getAttribute(name: string): string | true | undefined {
      return attributesByName.get(name.toLowerCase())?.value;
    },
    getLiteralAttribute(name: string): string | true | undefined {
      const attribute = attributesByName.get(name.toLowerCase());
      return attribute && !attribute.dynamic ? attribute.value : undefined;
    },
    isAttributeDynamic(name: string): boolean {
      return attributesByName.get(name.toLowerCase())?.dynamic ?? false;
    },
    childrenWithTag(tagName: string): readonly TagElement[] {
      const normalized = tagName.toLowerCase();
      return children.filter((child) => child.tag === normalized);
    },
    childrenWithoutTag(tagName: string): readonly TagElement[] {
      const normalized = tagName.toLowerCase();
      return children.filter((child) => child.tag !== normalized);
    },
  };
}

function resolveSeverity(
  rules: RulesConfig | undefined,
  validator: TagValidator,
): RuleSeverity {
  const entry = rules?.[validator.id];
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') return entry.severity;
  return validator.severity ?? 'error';
}

function reportNode(element: TagElement, attribute?: string): BalanceNode {
  const facade = element as Facade;
  if (attribute) {
    const attr = facade.attributesByName.get(attribute.toLowerCase());
    if (attr) return attr.attrNode;
  }
  return facade.startTag;
}

export function checkTagValidators(
  rootNode: BalanceNode,
  validators: TagValidator[] | undefined,
  customTagNames: Set<string>,
  rules: RulesConfig | undefined,
): CheckError[] {
  if (!validators || validators.length === 0 || customTagNames.size === 0) {
    return [];
  }
  const byTag = new Map<string, TagValidator[]>();
  for (const validator of validators) {
    const severity = resolveSeverity(rules, validator);
    if (severity === 'off') continue;
    for (const tag of validator.tags) {
      const normalized = tag.toLowerCase();
      if (!customTagNames.has(normalized)) continue;
      const list = byTag.get(normalized) ?? [];
      list.push(validator);
      byTag.set(normalized, list);
    }
  }
  if (byTag.size === 0) return [];

  const errors: CheckError[] = [];
  function visit(node: BalanceNode): void {
    if (isHtmlElementType(node)) {
      const tag = getTagName(node)?.toLowerCase();
      const matching = tag ? byTag.get(tag) : undefined;
      if (matching) {
        for (const validator of matching) {
          const severity = resolveSeverity(rules, validator);
          if (severity === 'off') continue;
          const element = buildFacade(
            node,
            validator.options?.includeInnerHtml === true,
            true,
          );
          if (!element) continue;
          try {
            const report = (diagnostic: {
              element: TagElement;
              attribute?: string;
              message: string;
            }): void => {
              errors.push({
                node: reportNode(diagnostic.element, diagnostic.attribute),
                message: diagnostic.message,
                severity: severity === 'warning' ? 'warning' : 'error',
                ruleName: validator.id,
              });
            };
            validator.validate(element, {
              report,
              reportElement(target, message) {
                report({ element: target, message });
              },
              reportAttribute(target, attribute, message) {
                report({ element: target, attribute, message });
              },
            });
          } catch (error) {
            errors.push({
              node: element.startTag,
              message: `Validator "${validator.id}" failed: ${error instanceof Error ? error.message : String(error)}`,
              severity: 'error',
              ruleName: validator.id,
            });
          }
        }
      }
    }
    for (const child of node.children) visit(child);
  }
  visit(rootNode);
  return errors;
}
