const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');

const Parser = require('tree-sitter');

test('can load grammar', () => {
  const parser = new Parser();
  assert.doesNotThrow(() => parser.setLanguage(require('.')));
});

for (const example of ['deeply-nested.html', 'deeply-nested-custom.html']) {
  test(`can parse ${example}`, () => {
    const parser = new Parser();
    parser.setLanguage(require('.'));
    const source = readFileSync(
      join(__dirname, '../../examples', example),
      'utf8',
    );
    const tree = parser.parse(source);
    assert.strictEqual(tree.rootNode.hasError, false);
    assert.strictEqual(tree.rootNode.endIndex, source.length);
  });
}
