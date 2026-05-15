/**
 * Public `./linter` entry. Returns a handle with `lint(source, config)` that
 * produces diagnostics from built-in rules, custom selector-based rules, and
 * custom-tag JSON-Schema validation.
 *
 * Runtime: web-tree-sitter. No filesystem use — the CLI wraps this with
 * config-file loading and glob filtering.
 */

import { collectErrors } from './collectErrors.js';
import type { WalkableTree } from './collectErrors.js';
import { toDiagnostic } from './diagnostic.js';
import type { Diagnostic } from './diagnostic.js';
import { loadSchemaRegistry } from '../shared/customTagSchemaLoader.js';
import type { SchemaFormat } from '../shared/customTagSchemaLoader.js';
import { RULE_DEFAULTS } from '../shared/ruleMetadata.js';
import { KNOWN_RULE_NAMES } from '../shared/ruleMetadata.js';
import type { ConfigLoadError } from '../shared/customTagSchemaLoader.js';
import type {
  HtmlMustacheConfig,
  RulesConfig,
  RuleSeverity,
  CustomRule as CustomRuleType,
} from '../shared/configSchema.js';
import {
  collectCustomTagNames,
  type ChildTagConfig,
  type CustomCodeTagConfig,
} from '../shared/customCodeTags.js';
import type {
  AttributeValue,
  AttributeValueFor,
  TagElement,
  TagValidatorFn,
  TagValidatorRule,
  TagValidatorRuleEntry,
  TagValidator,
  ValidatorContext,
} from '../shared/tagValidators.js';
import {
  defineTagValidators,
  isSyntacticRuleId,
} from '../shared/tagValidators.js';
import {
  createTreeSitterRuntime,
  type LocateWasm,
} from '../shared/treeSitterRuntime.js';

/**
 * `include`/`exclude` on custom rules are stripped from the in-memory API
 * surface: there is no filesystem path to match against, so those fields
 * would silently do nothing. The CLI applies them via `customRuleFilter`
 * before calling `lint`.
 */
export type CustomRule = Omit<CustomRuleType, 'include' | 'exclude'>;
export type Config = Omit<
  HtmlMustacheConfig,
  'include' | 'exclude' | 'customRules'
> & { customRules?: CustomRule[] };
export type CustomTag = CustomCodeTagConfig;
export type {
  RulesConfig,
  RuleSeverity,
  Diagnostic,
  SchemaFormat,
  AttributeValue,
  AttributeValueFor,
  TagElement,
  TagValidatorFn,
  TagValidatorRule,
  TagValidatorRuleEntry,
  TagValidator,
  ValidatorContext,
};
export { defineTagValidators };

export interface CreateLinterOptions {
  /**
   * Locates the grammar WASM (`tree-sitter-htmlmustache.wasm`). String form
   * is treated as the URL for the grammar — web-tree-sitter resolves its own
   * `tree-sitter.wasm` via its default `locateFile`. Pass a callback to
   * resolve both names explicitly.
   */
  locateWasm: LocateWasm;
  /**
   * ajv formats registered on the schema validator. Consumers use this to
   * add named formats (e.g. a case-insensitive `pl-boolean`) that their tag
   * schemas reference via `{ "format": "<name>" }`.
   */
  formats?: Record<string, SchemaFormat>;
  /**
   * Synchronous custom-tag validators. They run for matching tags that are
   * also declared in `customTags`.
   */
  validators?: TagValidator[];
}

export interface Linter {
  lint(source: string, config?: Config): Diagnostic[];
}

/** Default severities for every built-in rule. */
export const DEFAULT_CONFIG: Config = { rules: RULE_DEFAULTS as RulesConfig };

function normalizeValidators(validators: TagValidator[] | undefined): {
  validators: TagValidator[] | undefined;
  loadErrors: ConfigLoadError[];
} {
  if (!validators) return { validators, loadErrors: [] };
  const loadErrors: ConfigLoadError[] = [];
  const valid = validators.filter((validator, index) => {
    if (!isSyntacticRuleId(validator.id)) {
      loadErrors.push({
        ruleName: 'pluginModule',
        message: `Invalid validator descriptor at validators[${index}].`,
      });
      return false;
    }
    return true;
  });
  const counts = new Map<string, number>();
  for (const validator of valid) {
    counts.set(validator.id, (counts.get(validator.id) ?? 0) + 1);
  }
  const conflicting = new Set<string>();
  for (const [id, count] of counts) {
    if (count > 1 || KNOWN_RULE_NAMES.has(id)) {
      conflicting.add(id);
      loadErrors.push({
        ruleName: 'pluginModule',
        message: KNOWN_RULE_NAMES.has(id)
          ? `Validator id "${id}" conflicts with a built-in rule name.`
          : `Duplicate validator id "${id}".`,
      });
    }
  }
  return {
    validators: valid.filter((validator) => !conflicting.has(validator.id)),
    loadErrors,
  };
}

function stripFilesystemSchemas(
  tags: CustomCodeTagConfig[] | undefined,
): CustomCodeTagConfig[] | undefined {
  if (!tags) return undefined;
  const stripChild = (child: ChildTagConfig): ChildTagConfig => ({
    ...child,
    ...(typeof child.schema === 'string' ? { schema: undefined } : {}),
    ...(child.children ? { children: child.children.map(stripChild) } : {}),
  });
  return tags.map((tag) => ({
    ...tag,
    ...(typeof tag.schema === 'string' ? { schema: undefined } : {}),
    ...(tag.children ? { children: tag.children.map(stripChild) } : {}),
  }));
}

/**
 * Create a linter handle. Consumers should cache the result — each call
 * reloads the grammar WASM.
 */
export async function createLinter(opts: CreateLinterOptions): Promise<Linter> {
  const { locateWasm, formats, validators } = opts;
  const validatorResult = normalizeValidators(validators);
  const { parser } = await createTreeSitterRuntime({ locateWasm });

  return {
    lint(source, config) {
      const tree = parser.parse(source);
      if (!tree) throw new Error('Failed to parse document');
      try {
        const customTagNames = collectCustomTagNames(config?.customTags);
        const schemaResult = loadSchemaRegistry(
          stripFilesystemSchemas(config?.customTags),
          {
            customTagDefaults: config?.customTagDefaults,
            formats,
          },
        );
        const errors = collectErrors(
          tree as unknown as WalkableTree,
          config?.rules,
          customTagNames,
          config?.customRules,
          {
            schemaRegistry: schemaResult.registry,
            schemaLoadErrors: [
              ...schemaResult.loadErrors,
              ...validatorResult.loadErrors,
            ],
            validators: validatorResult.validators,
          },
        );
        return errors.map(toDiagnostic);
      } finally {
        tree.delete();
      }
    },
  };
}
