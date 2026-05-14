import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import type { Tree } from './parser.js';
import { collectErrors } from '../../../js/linter/collectErrors.js';
import type { RulesConfig, CustomRule } from '../../../js/shared/configSchema.js';
import type { ConfigLoadError, SchemaRegistry } from '../../../js/shared/customTagSchemaLoader.js';
import type { TagValidator } from '../../../js/shared/tagValidators.js';

export interface DiagnosticValidationOptions {
  schemaRegistry?: SchemaRegistry;
  schemaLoadErrors?: ConfigLoadError[];
  validators?: TagValidator[];
}

export function getDiagnostics(
  tree: Tree,
  rules?: RulesConfig,
  customTagNames?: string[],
  customRules?: CustomRule[],
  validation?: DiagnosticValidationOptions,
): Diagnostic[] {
  const errors = collectErrors(tree, rules, customTagNames, customRules, {
    schemaRegistry: validation?.schemaRegistry,
    schemaLoadErrors: validation?.schemaLoadErrors,
    validators: validation?.validators,
  });
  return errors.map(error => ({
    severity: error.severity === 'warning' ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
    range: {
      start: { line: error.node.startPosition.row, character: error.node.startPosition.column },
      end: { line: error.node.endPosition.row, character: error.node.endPosition.column },
    },
    message: error.message,
    source: 'htmlmustache',
    data: error.fix || error.ruleName
      ? { fix: error.fix, fixDescription: error.fixDescription, ruleName: error.ruleName }
      : undefined,
  }));
}
