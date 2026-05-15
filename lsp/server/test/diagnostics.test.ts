import { describe, expect, it } from 'vitest';
import { DiagnosticSeverity } from 'vscode-languageserver';

import { loadSchemaRegistry } from '../../../js/shared/customTagSchemaLoader.js';
import { parseText } from './setup.js';
import { getDiagnostics } from '../src/diagnostics.js';

function diagnosticsFor(source: string, ...args: Parameters<typeof getDiagnostics> extends [unknown, ...infer Rest] ? Rest : never) {
  return getDiagnostics(parseText(source), ...args);
}

describe('Diagnostics adapter', () => {
  it('maps linter errors to LSP diagnostics with zero-based ranges', () => {
    const diagnostics = diagnosticsFor('{{#foo}}\n{{/bar}}');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: DiagnosticSeverity.Error,
      message: 'Mismatched mustache section: {{/bar}}',
      source: 'htmlmustache',
      range: {
        start: { line: 1, character: 0 },
      },
    });
  });

  it('maps warning severities and preserves quick-fix metadata', () => {
    const diagnostics = diagnosticsFor('<p>a > b</p>');
    const warning = diagnostics.find((d) => d.message.includes('Unescaped'));

    expect(warning).toBeDefined();
    expect(warning!.severity).toBe(DiagnosticSeverity.Warning);
    expect(warning!.data).toMatchObject({
      fixDescription: 'Replace > with &gt;',
      ruleName: 'unescapedEntities',
    });
  });

  it('passes rule configuration through to the shared linter', () => {
    const diagnostics = diagnosticsFor('<p>a > b</p>', {
      unescapedEntities: 'off',
    });

    expect(diagnostics.some((d) => d.message.includes('Unescaped'))).toBe(
      false,
    );
  });

  it('passes custom tag names and custom rules through to the shared linter', () => {
    const customRuleDiagnostics = diagnosticsFor(
      '<font></font>',
      undefined,
      undefined,
      [{ id: 'no-font', selector: 'font', message: 'Deprecated element' }],
    );
    expect(
      customRuleDiagnostics.find((d) => d.message === 'Deprecated element'),
    ).toMatchObject({
      message: 'Deprecated element',
      severity: DiagnosticSeverity.Error,
    });

    const customTagDiagnostics = diagnosticsFor(
      '<pl-card></pl-card>',
      { unrecognizedHtmlTags: 'error' },
      ['pl-card'],
    );
    expect(
      customTagDiagnostics.some((d) => d.message.includes('Unrecognized')),
    ).toBe(false);
  });

  it('passes schema validation state through to the shared linter', () => {
    const { registry, loadErrors } = loadSchemaRegistry([
      {
        name: 'pl-card',
        schema: {
          $schema: 'http://json-schema.org/draft-06/schema#',
          type: 'object',
          properties: { kind: { enum: ['primary'] } },
          required: ['kind'],
        },
      },
    ]);
    expect(loadErrors).toEqual([]);

    const diagnostics = diagnosticsFor(
      '<pl-card></pl-card>',
      { customTagSchema: 'error' },
      ['pl-card'],
      undefined,
      { schemaRegistry: registry },
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      message: '<pl-card> is missing required attribute "kind".',
      severity: DiagnosticSeverity.Error,
    });
  });
});
