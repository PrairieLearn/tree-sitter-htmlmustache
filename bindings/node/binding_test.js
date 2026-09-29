const assert = require('node:assert');
const { test } = require('node:test');

const Parser = require('tree-sitter');

test('can load grammar and parse HTML with Mustache', () => {
  const parser = new Parser();
  parser.setLanguage(require('.'));
  const source = '<p>Hello {{name}}</p>';
  const tree = parser.parse(source);
  assert.strictEqual(tree.rootNode.hasError, false);
  assert.strictEqual(tree.rootNode.endIndex, source.length);
});
