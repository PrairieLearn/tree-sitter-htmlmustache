import { describe, expect, it } from 'vitest';
import { concat, fill, group, hardline, indent, line, softline } from './ir.js';
import { print } from './printer.js';

describe('printer indentation', () => {
  it.each([hardline, line, softline])(
    'does not indent blank lines from $type',
    (newline) => {
      const doc = indent(
        concat([newline, 'a', newline, '', newline, 'b', newline]),
      );
      for (const indentUnit of ['  ', '\t']) {
        expect(print(doc, { indentUnit })).toBe(
          `\n${indentUnit}a\n\n${indentUnit}b\n`,
        );
      }
    },
  );

  it('keeps the indentation of the break when leaving an indent', () => {
    const doc = concat([indent(hardline), 'text']);
    expect(print(doc, { indentUnit: '\t' })).toBe('\n\ttext');
  });

  it('counts pending indentation when fitting groups and fills', () => {
    for (const contents of [
      group(concat(['aa', line, 'bb'])),
      fill(['aa', line, 'bb']),
    ]) {
      const doc = indent(concat([hardline, contents]));
      expect(print(doc, { indentUnit: '  ', printWidth: 6 })).toBe(
        '\n  aa\n  bb',
      );
      expect(print(doc, { indentUnit: '  ', printWidth: 7 })).toBe('\n  aa bb');
    }
  });

  it('preserves literal whitespace', () => {
    const literal = 'text  \n \t\nnext\t';
    const doc = indent(concat([hardline, literal, hardline, '  ', hardline]));
    expect(print(doc, { indentUnit: '  ' })).toBe(`\n  ${literal}\n    \n`);
  });

  it('does not add indentation before a literal newline', () => {
    const doc = indent(concat([hardline, '\n', hardline, 'text']));
    expect(print(doc, { indentUnit: '  ' })).toBe('\n\n\n  text');
  });
});
