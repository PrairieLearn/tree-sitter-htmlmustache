<p align="center">
  <img src="lsp/icon.png" alt="HTML Mustache Logo" width="128">
</p>

<h1 align="center">HTML Mustache</h1>

<p align="center">
  <strong>Full language support for HTML with Mustache/Handlebars templates</strong>
</p>

<p align="center">
  <a href="https://github.com/reteps/tree-sitter-htmlmustache/actions/workflows/lint.yml"><img src="https://img.shields.io/github/actions/workflow/status/reteps/tree-sitter-htmlmustache/lint.yml?logo=github&label=Lint" alt="Lint"></a>
  <a href="https://github.com/reteps/tree-sitter-htmlmustache/actions/workflows/lsp.yml"><img src="https://img.shields.io/github/actions/workflow/status/reteps/tree-sitter-htmlmustache/lsp.yml?logo=github&label=LSP" alt="LSP"></a>
  <a href="https://open-vsx.org/extension/reteps/htmlmustache-lsp"><img src="https://img.shields.io/open-vsx/v/reteps/htmlmustache-lsp?logo=visualstudiocode&label=VS%20Code" alt="Open VSX"></a>
  <a href="https://www.npmjs.com/package/@reteps/tree-sitter-htmlmustache"><img src="https://img.shields.io/npm/v/@reteps/tree-sitter-htmlmustache?logo=npm&label=npm" alt="npm"></a>
  <a href="https://pypi.org/project/tree-sitter-htmlmustache/"><img src="https://img.shields.io/pypi/v/tree-sitter-htmlmustache?logo=pypi&logoColor=white&label=PyPI" alt="PyPI"></a>
</p>

---

## Features

- **Syntax Highlighting** — Full semantic highlighting for HTML and Mustache, plus embedded JS/TS in `<script>` and CSS in `<style>`
- **Document Formatting** — Auto-format with EditorConfig and config file support
- **CLI Linter & Formatter** — Check and format templates from the command line
- **Document Symbols** — Outline view and breadcrumb navigation
- **Folding** — Collapse HTML elements and Mustache sections
- **Hover Information** — Tag and attribute documentation

### Supported Mustache Syntax

| Syntax                    | Description            |
| ------------------------- | ---------------------- |
| `{{name}}`                | Variable interpolation |
| `{{{html}}}`              | Unescaped HTML         |
| `{{#items}}...{{/items}}` | Sections               |
| `{{^items}}...{{/items}}` | Inverted sections      |
| `{{! comment }}`          | Comments               |
| `{{> partial}}`           | Partials               |

## VS Code Extension

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=reteps.htmlmustache-lsp) or search for "HTML Mustache" in the Extensions view.

What you get out of the box:

- Syntax highlighting (including embedded JS/TS and CSS)
- Document formatting (format on save, format selection)
- Error diagnostics (parse errors, mismatched tags)
- Document outline and breadcrumbs
- Hover information for HTML tags and attributes
- Code folding for HTML elements and Mustache sections

### Using with `.html` Files

By default, the extension activates for `.mustache`, `.hbs`, and `.handlebars` files. To use it with `.html` files, add this to your VS Code settings:

```json
{
  "files.associations": {
    "*.html": "htmlmustache"
  }
}
```

You can also change the language mode for a single file by clicking the language indicator in the status bar and selecting "HTML Mustache".

## CLI

Install globally or run via `npx`:

```
npm install -g @reteps/tree-sitter-htmlmustache
```

### `htmlmustache check`

Check templates for parse errors:

```
htmlmustache check '**/*.mustache' '**/*.hbs'
```

If `include` is configured in `.htmlmustache.jsonc`, patterns are optional:

```
htmlmustache check
```

```
file.mustache:3:3 error: Mismatched mustache section: {{/wrong}}
  |
1 | {{#items}}
2 |   <li>{{name}}
3 |   {{/wrong}}
  |   ^^^^^^^^^^ Mismatched mustache section: {{/wrong}}

1 error in 1 file (5 files checked)
```

Detects parse errors, mismatched Mustache sections, mismatched HTML end tags, and missing tokens.

### `htmlmustache format`

Format templates:

```
htmlmustache format --write '**/*.mustache'
```

If `include` is configured in `.htmlmustache.jsonc`, patterns are optional:

```
htmlmustache format --write
```

Check formatting in CI (exits 1 if any files would change):

```
htmlmustache format --check 'templates/**/*.hbs'
```

Read from stdin:

```
echo '<div><p>hi</p></div>' | htmlmustache format --stdin
```

**Options:**

| Flag                | Description                                      |
| ------------------- | ------------------------------------------------ |
| `--write`           | Modify files in-place (default: print to stdout) |
| `--check`           | Exit 1 if any files would change (for CI)        |
| `--stdin`           | Read from stdin, write to stdout                 |
| `--indent-size N`   | Spaces per indent level (default: 2)             |
| `--print-width N`   | Max line width (default: 80)                     |
| `--mustache-spaces` | Add spaces inside mustache delimiters            |

## Python API

The grammar is also published to PyPI as [`tree-sitter-htmlmustache`](https://pypi.org/project/tree-sitter-htmlmustache/) for use with [`py-tree-sitter`](https://github.com/tree-sitter/py-tree-sitter).

```bash
pip install tree-sitter tree-sitter-htmlmustache
```

```python
from tree_sitter import Language, Parser
import tree_sitter_htmlmustache

parser = Parser(Language(tree_sitter_htmlmustache.language()))
tree = parser.parse(b"<div>{{#items}}<li>{{name}}</li>{{/items}}</div>")
print(tree.root_node)
```

## JavaScript API

The package ships three independent subpath exports. Pick the one you need; each pulls in only its own deps.

| Subpath       | What you get                                                                    | Deps                               |
| ------------- | ------------------------------------------------------------------------------- | ---------------------------------- |
| `./parser`    | `createParser({ locateWasm })` → typed JSON AST + `walk` helper                 | `web-tree-sitter`                  |
| `./linter`    | `createLinter({ locateWasm })` → `lint(source, config) → Diagnostic[]`          | `web-tree-sitter`, `ajv`           |
| `./formatter` | `createFormatter({ locateWasm, prettier })` → `format(source, config) → string` | `web-tree-sitter`, peer `prettier` |
| `./wasm`      | Direct URL of `tree-sitter-htmlmustache.wasm`                                   | —                                  |

### Parser — typed JSON AST

```ts
import { createParser, walk } from '@reteps/tree-sitter-htmlmustache/parser';

const parser = await createParser({
  locateWasm: '/static/tree-sitter-htmlmustache.wasm',
});

const { rootNode, hasError } = parser.parse('<p>{{name}}</p>');

walk(rootNode, (node, parents) => {
  switch (node.type) {
    case 'html_element':
      // node.children is narrowed to HtmlStartTagNode | HtmlEndTagNode | ...
      console.log('element:', node.text);
      break;
    case 'mustache_interpolation':
      // node.children: MustacheIdentifierNode | MustachePathExpressionNode
      console.log('interpolation:', node.text);
      break;
  }
});
```

The `SyntaxNode` discriminated union is generated from the grammar's
`node-types.json` — switching on `node.type` narrows `node.children` to the
exact set of allowed children. Build your own validator on top of `walk` with
full autocomplete and exhaustiveness checking.

### Linter

```ts
import {
  createLinter,
  DEFAULT_CONFIG,
} from '@reteps/tree-sitter-htmlmustache/linter';

const linter = await createLinter({
  locateWasm: '/static/tree-sitter-htmlmustache.wasm',
});
const diagnostics = linter.lint('<a href={{url}}></a>', DEFAULT_CONFIG);
// → [{ line, column, severity: 'error', ruleName: 'unquotedMustacheAttributes', message, ... }]
```

Custom rules and per-tag JSON-Schema validation are passed through the
`config` argument — see the [Configuration](#configuration) section for the
shape.

### Formatter

```ts
import { createFormatter } from '@reteps/tree-sitter-htmlmustache/formatter';
import prettier from 'prettier';

const formatter = await createFormatter({
  locateWasm: '/static/tree-sitter-htmlmustache.wasm',
  prettier, // optional — for embedded <script> / <style>
});

const formatted = await formatter.format('<div><p>hi</p></div>', {
  indentSize: 2,
});
```

### `locateWasm`

Both a string (URL of the grammar wasm) and a callback are supported:

```ts
locateWasm: (name) => {
  if (name === 'tree-sitter-htmlmustache.wasm')
    return '/static/htmlmustache.wasm';
  return `/static/${name}`; // web-tree-sitter resolves tree-sitter.wasm itself
};
```

In Node, pass absolute file paths. In the browser, pass URLs.

## Format Ignore

Skip formatting for specific regions using ignore directives. Both HTML and Mustache comment forms are supported.

### Ignore Next Node

Place a comment immediately before the element to preserve its original formatting:

```html
<!-- htmlmustache-ignore -->
<div class="a" id="b">manually formatted</div>
```

```html
{{! htmlmustache-ignore }}
<table>
  <tr>
    <td>compact</td>
    <td>table</td>
  </tr>
</table>
```

Only the immediately following sibling node is ignored. Subsequent nodes are formatted normally.

### Ignore Region

Wrap a region in start/end comments to preserve everything between them:

```html
<!-- htmlmustache-ignore-start -->
<div class="a">content</div>
<p>kept as-is</p>
<!-- htmlmustache-ignore-end -->
```

```html
{{! htmlmustache-ignore-start }} {{#items}}
<li>{{name}}</li>
{{/items}} {{! htmlmustache-ignore-end }}
```

If `ignore-start` has no matching `ignore-end`, all remaining siblings in the current scope are preserved as raw text.

## Configuration

### `.htmlmustache.jsonc`

Create a `.htmlmustache.jsonc` file in your project root to configure formatting options. Both the VS Code extension and CLI will pick it up automatically (the file is found by walking up from the formatted file).

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/reteps/tree-sitter-htmlmustache/main/schemas/htmlmustache-config.schema.json",

  // File patterns for CLI commands (used when no patterns are passed as arguments)
  "include": ["**/*.mustache", "**/*.hbs"],

  // Patterns to always exclude (node_modules and .git are excluded by default)
  "exclude": ["**/vendor/**"],

  // Max line width before wrapping (default: 80)
  "printWidth": 100,

  // Spaces per indent level (default: 2)
  "indentSize": 4,

  // Add spaces inside mustache delimiters: {{ foo }} vs {{foo}} (default: false)
  "mustacheSpaces": true,

  // Treat custom tags as raw code blocks (like <script>/<style>), or bind
  // a JSON Schema for attribute/child validation — see Tag Schemas below.
  "customTags": [
    {
      "name": "x-code",
      "languageDefault": "javascript",
    },
  ],
}
```

The schema URL above tracks `main`. For release-pinned validation, replace
`main` with a tag such as `v1.4.0`.

### Lint Rules

The following checks are always enabled and report as errors:

- **Syntax errors** — invalid or unparseable template syntax
- **Missing tokens** — e.g. a missing closing `>`
- **Mismatched mustache sections** — `{{/wrong}}` closing a different section than was opened
- **Mismatched HTML tags** — closing tags that don't match their opening tag, including across mustache branches
- **Unclosed HTML tags** — non-void elements that are never closed

Additionally, the following rules are configurable. Set their severities (`"error"`, `"warning"`, or `"off"`) in the `rules` object:

```jsonc
{
  "rules": {
    "consecutiveDuplicateSections": "off",
    "preferMustacheComments": "warning",
  },
}
```

<!-- RULES_TABLE_START -->

| Rule                           | Default   | Description                                                                   |
| ------------------------------ | --------- | ----------------------------------------------------------------------------- |
| `nestedDuplicateSections`      | `error`   | Flags `{{#name}}` nested inside another `{{#name}}` with the same name        |
| `unquotedMustacheAttributes`   | `error`   | Requires quotes around mustache expressions used as attribute values          |
| `consecutiveDuplicateSections` | `warning` | Warns when adjacent same-name sections can be merged                          |
| `selfClosingNonVoidTags`       | `error`   | Disallows self-closing syntax on non-void HTML elements (e.g. `<div/>`)       |
| `duplicateAttributes`          | `error`   | Detects duplicate HTML attributes on the same element                         |
| `unescapedEntities`            | `warning` | Flags unescaped `&`, `<`, and `>` characters in text content                  |
| `preferMustacheComments`       | `off`     | Suggests replacing HTML comments with mustache comments                       |
| `unrecognizedHtmlTags`         | `error`   | Flags HTML tags that are not standard HTML elements or valid custom elements  |
| `elementContentTooLong`        | `off`     | Flags configured elements whose inner content exceeds a byte-length threshold |
| `customTagSchema`              | `error`   | Validates configured custom tags against their JSON Schema contracts          |
| `customTagDeprecations`        | `warning` | Surfaces `deprecated: true` annotations in custom tag schemas                 |
| `pluginModule`                 | `error`   | Reports plugin module load and export-shape failures                          |

<!-- RULES_TABLE_END -->

### Tag Schemas

Custom tags can declare a JSON Schema draft-06 contract. The schema may be inline or a path resolved relative to `.htmlmustache.jsonc`:

```jsonc
{
  "customTags": [
    {
      "name": "pl-multiple-choice",
      "schema": "elements/pl-multiple-choice/pl-multiple-choice.schema.json",
    },
  ],
  "rules": {
    "customTagSchema": "error",
  },
}
```

Schemas validate the tag's flat attribute object. The tag name is implicit from `customTags[].name`:

```jsonc
{
  "answers-name": "q1",
  "weight": "2",
  "disabled": true,
}
```

Attribute values are coerced by JSON Schema (`"2"` can satisfy an integer, boolean attributes become `true`). Attribute values containing mustache are treated as unknown runtime values, so value-dependent schema errors are waived while presence and unknown-attribute checks still run.

HTML boolean attributes are allowed on custom tags by default, so `<pl-answer correct>` validates as `{ "correct": true }`. To require explicit values for custom tag attributes by default, set `customTagDefaults.allowBooleanAttributes` to `false`; individual custom tag entries can opt back in:

```jsonc
{
  "customTagDefaults": { "allowBooleanAttributes": false },
  "customTags": [{ "name": "pl-answer", "allowBooleanAttributes": true }],
}
```

When boolean attributes are disabled for a custom tag, `<pl-answer correct>` reports `Attribute "correct" on <pl-answer> must have a value.` Ordinary HTML boolean attributes such as `<input disabled>` are not affected by this custom tag setting.

Custom tags can also declare parent-owned child schemas. Child schemas validate a direct child tag's flat attribute object only in the context of that parent:

```jsonc
{
  "customTags": [
    {
      "name": "pl-multiple-choice",
      "schema": "elements/pl-multiple-choice/pl-multiple-choice.schema.json",
      "children": [
        {
          "name": "pl-answer",
          "schema": "elements/pl-multiple-choice/pl-answer.schema.json",
        },
      ],
    },
    { "name": "pl-answer" },
  ],
}
```

By default, the example above allows only direct `<pl-answer>` HTML elements under `<pl-multiple-choice>`. Set `"allowAdditionalChildren": true` on the parent tag to keep unlisted direct child elements allowed while still schema-validating listed child tags when they appear. Mustache sections are transparent for this check: `<pl-answer>` inside `{{#cond}}...{{/cond}}` still counts as a direct child of the surrounding parent element.

Parent-owned child schemas do not create a global schema for the child tag. A bare `<pl-answer>` outside `<pl-multiple-choice>` is recognized by `{ "name": "pl-answer" }`, but it does not use the multiple-choice-specific child schema.

If a child tag is declared only inside `children` and is not listed as a top-level `customTags` entry, it is recognized only as a child-owned tag and may appear only as a direct child of the parent tags that declared it. Listing the same tag at the top level means it can also appear in any other context.

`children` can be nested recursively. Each level still validates only direct children, so this keeps `<pl-answer>` scoped to `<pl-multiple-choice>` while giving `<pl-answer>` its own allowed direct child tags:

```jsonc
{
  "customTags": [
    {
      "name": "pl-multiple-choice",
      "children": [
        {
          "name": "pl-answer",
          "schema": "elements/pl-multiple-choice/pl-answer.schema.json",
          "children": [{ "name": "pl-answer-feedback" }],
        },
      ],
    },
  ],
}
```

Same-name child entries are self-references. This child-only recursive tag allows `<pl-node>` to nest under itself at any depth while still rejecting other direct children:

```jsonc
{
  "customTags": [
    {
      "name": "pl-tree",
      "children": [
        {
          "name": "pl-node",
          "children": [{ "name": "pl-node" }],
        },
      ],
    },
  ],
}
```

Example schema:

```jsonc
{
  "$schema": "http://json-schema.org/draft-06/schema#",
  "type": "object",
  "properties": {
    "answers-name": { "type": "string" },
    "weight": { "type": "number", "minimum": 0 },
    "disabled": { "type": "boolean" },
  },
  "required": ["answers-name"],
  "additionalProperties": false,
}
```

Schemas must declare draft-06 using `http://json-schema.org/draft-06/schema#` (the `https` form and missing trailing `#` are also accepted). `htmlGlobalAttributes`, custom AJV keywords, and schema access to `tag`, `text`, `innerHtml`, or `children` are intentionally not supported; use tag validators for content or relationship checks.

#### Diagnostics

Schema diagnostics are phrased in HTML/element terms rather than JSON-Schema vocabulary, so template authors aren't asked to translate `instancePath` and `additionalProperty` back into the markup they wrote. Examples:

| Schema constraint                 | Diagnostic                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `required: ["answers-name"]`      | `<pl-multiple-choice> is missing required attribute "answers-name".`                            |
| `additionalProperties: false`     | `Unknown attribute "extra" on <pl-multiple-choice>.`                                            |
| strict unlisted child             | `<pl-multiple-choice> only allows these child elements: <pl-answer>.`                           |
| child-only tag outside its parent | `<pl-answer> may only appear as a direct child of these parent elements: <pl-multiple-choice>.` |
| child `additionalProperties`      | `Unknown attribute "ranking" on <pl-answer> inside <pl-multiple-choice>.`                       |
| custom tag boolean attribute      | `Attribute "correct" on <pl-answer> must have a value.`                                         |
| `properties.display.enum`         | `Attribute "display" on <pl-multiple-choice> must be one of: "block", "inline".`                |
| `properties.size.type: "integer"` | `Attribute "size" on <pl-multiple-choice> must be integer.`                                     |
| `properties.weight.minimum: 0`    | `Attribute "weight" on <pl-multiple-choice> must be >= 0.`                                      |

Constraints without a rewriter fall through to ajv's localized text. Every diagnostic carries `ruleName: "customTagSchema"` and points at the element or attribute — see [Disabling Lint Rules](#disabling-lint-rules) to silence them per-region.

#### Custom error messages

Override individual diagnostics with JSON Schema's [`errorMessage` keyword](https://ajv.js.org/packages/ajv-errors.html) (enabled via [`ajv-errors`](https://www.npmjs.com/package/ajv-errors)). Authored strings flow through unchanged — the HTML-shaped rewriter only kicks in when the schema doesn't provide one.

```jsonc
{
  "type": "object",
  "required": ["answers-name"],
  "properties": {
    "size": { "type": "integer", "minimum": 1 },
    "display": { "enum": ["block", "inline", "dropdown"] },
  },
  "errorMessage": {
    "required": {
      // Per-property override for `required` failures
      "answers-name": "Add `answers-name=\"...\"` so this question can be graded.",
    },
    "properties": {
      // Per-property override for *value-level* failures (type, minimum, enum, ...)
      "size": "`size` must be a positive whole number — got ${0}.",
      "display": "`display` must be one of: block, inline, dropdown.",
    },
    // Catch-all for the whole object
    "_": "<pl-multiple-choice> failed its schema.",
  },
}
```

ajv-errors substitutes the original ajv error with one whose message is your string; the rewriter sees `keyword: "errorMessage"`, doesn't recognise it, and passes the string through. Use this when the default phrasing doesn't say enough about your domain (e.g. linking authors to a runbook URL, naming a specific config the attribute drives).

#### Tag validators

Use synchronous JavaScript validators for checks that need children, content, ordering, or cross-element relationships. Validators run only for tags that are also declared in `customTags[]`; the plugin does not make undeclared tags known by itself.

```js
// scripts/htmlmustache-plugin.mjs
import {
  attr,
  defineTagValidators,
  validateAttributes,
  validateElement,
} from '@reteps/tree-sitter-htmlmustache/linter';

export const validators = defineTagValidators('pl-order-blocks', {
  'pl/order-blocks-children'(element, context) {
    for (const child of element.childrenWithoutTag('pl-answer')) {
      context.reportElement(
        child,
        '<pl-order-blocks> only allows <pl-answer> children.',
      );
    }
  },
  'pl/order-blocks-attributes'(element, context) {
    const gradingMethod =
      attr(element, 'grading-method').literalMap((value) =>
        typeof value === 'string' ? value : undefined,
      ) ?? 'ordered';
    if (!['ordered', 'unordered'].includes(gradingMethod)) {
      context.reportAttribute(
        element,
        'grading-method',
        'grading-method must be ordered or unordered.',
      );
    }

    validateElement(context, element, {
      reportAttribute: 'code-language',
      invalid(target) {
        return (
          attr(target, 'code-language').present() &&
          attr(target, 'format').literal() !== 'code'
        );
      },
      message: 'code-language is only valid when format is code.',
    });

    validateAttributes(context, element, ['min-incorrect'], {
      invalid(_target, attribute) {
        return (
          attribute.present() &&
          attribute.literal() !== undefined &&
          attribute.literalMap((value) => {
            if (typeof value !== 'string') return undefined;
            const trimmed = value.trim();
            if (!/^[+-]?\d+$/.test(trimmed)) return undefined;
            return Number(trimmed);
          }) === undefined
        );
      },
      message(_target, attribute) {
        return `${attribute.name} must be an integer.`;
      },
    });
  },
});
```

`element.children` contains direct child HTML elements. Mustache sections are transparent, so children inside `{{#section}}...{{/section}}` are included. Child facades are populated recursively, so validators can inspect nested direct children from each child facade. `element.innerHtml` is present only when the validator opts into `options.includeInnerHtml`.

`defineTagValidators(tagOrTags, rules)` is optional sugar for plugin authors. It lowercases the target tag or tags and expands each rule-map entry into an independent validator; rule-map keys are the exact rule ids used by `rules` config and inline disable comments. A rule can be a bare validation function or an object with `validate`, `severity`, and `options`.

Attribute helper names are case-insensitive. Use `attr(element, name).present()` for presence and `attr(element, name).literal()` when dynamic Mustache values should be treated as unknown. Use `attr(element, name).literalMap(mapper)` to convert literal values into project-specific enums, booleans, numbers, or other validated values. `literalMap(mapper)` runs only for literal values and returns `undefined` when the attribute is missing, dynamic, or rejected by the mapper.

Use `validateElement(context, element, options)` and `validateAttributes(context, element, names, options)` for common report-if-invalid checks. `validateElement` reports on the element unless `options.reportAttribute` is set. `validateAttributes` passes an attribute helper to `invalid(element, attribute)` and reports against the matching attribute name.

Use `childrenWithTag(tag)` and `childrenWithoutTag(tag)` for direct child tag checks. `ValidatorContext` also exposes `reportElement(element, message)` and `reportAttribute(element, name, message)` as shorthand for `report(...)`.

Validator ids are rule ids. Configure severity and inline disables the same way as built-in rules:

```jsonc
{
  "rules": {
    "pl/order-blocks-children": "warning",
  },
}
```

#### Custom formats

Schemas can use the `format` keyword for value rules that don't fit into `enum`/`pattern`/`type` — for example, the case-insensitive truthy-string set PrairieLearn accepts for boolean attributes (`true`/`t`/`1`/`yes`/`y`/`on` and their negatives, any case). Register the format implementation programmatically when constructing the linter:

```ts
import {
  createLinter,
  type SchemaFormat,
} from '@reteps/tree-sitter-htmlmustache/linter';

const BOOLEAN_STRINGS = new Set([
  'true',
  't',
  '1',
  'yes',
  'y',
  'on',
  'false',
  'f',
  '0',
  'no',
  'n',
  'off',
]);
const plBoolean: SchemaFormat = (value) =>
  typeof value === 'string' && BOOLEAN_STRINGS.has(value.toLowerCase());

const linter = await createLinter({
  locateWasm,
  formats: { 'pl-boolean': plBoolean },
});
```

A schema then references it like any built-in format:

```jsonc
{
  "$schema": "http://json-schema.org/draft-06/schema#",
  "type": "object",
  "properties": {
    "fixed-order": { "type": "string", "format": "pl-boolean" },
  },
}
```

Formats are functions (or `RegExp`, or ajv [`FormatDefinition`](https://ajv.js.org/options.html#formats) objects), so they can't live directly in `.htmlmustache.jsonc`. For the CLI and the VS Code extension (which both load `.htmlmustache.jsonc`), supply them through a `pluginModule` field pointing at a relative JS/TS file that exports a `formats` record:

```jsonc
// .htmlmustache.jsonc
{
  "customTags": [
    {
      "name": "pl-multiple-choice",
      "schema": "elements/pl-multiple-choice/pl-multiple-choice.schema.json",
    },
  ],
  "pluginModule": "./scripts/htmlmustache-plugin.mjs",
  "rules": { "customTagSchema": "error" },
}
```

```js
// scripts/htmlmustache-plugin.mjs
const BOOLEAN_STRINGS = new Set([
  'true',
  't',
  '1',
  'yes',
  'y',
  'on',
  'false',
  'f',
  '0',
  'no',
  'n',
  'off',
]);

export const formats = {
  'pl-boolean': (value) =>
    typeof value === 'string' && BOOLEAN_STRINGS.has(value.toLowerCase()),
};
```

The CLI and the language server dynamically import this file once per process (cached by absolute path) and register the exports before linting. Note the trust implication: pointing `pluginModule` at a path means running that code in-process when the CLI lints or the VS Code extension opens a document — treat it like a build script in your repo.

If the file can't be loaded, or its export shape is wrong, you'll see a `pluginModule`-rule diagnostic naming the path in the failure message; tag schemas that reference an unregistered format will then fail at compile time with the standard ajv "unknown format" error.

### Custom Rules

Define project-specific lint rules using CSS-like selectors. Mustache constructs are written literally — `{{foo}}`, `{{{foo}}}`, `{{#section}}`, `{{^inverted}}`, `{{!comment}}`, `{{>partial}}`:

```jsonc
{
  "customRules": [
    {
      "id": "no-font",
      "selector": "font",
      "message": "The <font> tag is deprecated. Use CSS instead.",
    },
    {
      "id": "images-need-alt",
      "selector": "img:not([alt])",
      "message": "Images must have alt text for accessibility",
    },
    {
      "id": "no-hidden-inputs-in-list",
      "selector": "{{#items}} > input[type=hidden]",
      "message": "Hidden inputs inside {{#items}} sections are usually a mistake",
    },
    {
      "id": "no-relative-client-files-question",
      "selector": "[src^=\"clientFilesQuestion/\"], [href^=\"clientFilesQuestion/\"]",
      "message": "Use {{options.client_files_question_url}}/... instead of a relative clientFilesQuestion/... path.",
      "severity": "warning",
    },
    {
      "id": "no-deprecated-param",
      "selector": "{{data.deprecated_param}}",
      "message": "data.deprecated_param was removed.",
    },
    {
      "id": "no-raw-user-input",
      "selector": "{{{user_input}}}",
      "message": "Never emit user text unescaped.",
    },
  ],
}
```

Each custom rule requires an `id`, `selector`, and `message`. The `severity` defaults to `"error"` but can be set to `"warning"` or `"off"`.

**Selector syntax:**

| Selector                                  | Matches                                    |
| ----------------------------------------- | ------------------------------------------ |
| `div`                                     | HTML elements by tag name                  |
| `*`                                       | Any HTML element                           |
| `#main`                                   | ID (shorthand for `[id="main"]`)           |
| `.panel`                                  | Class (shorthand for `[class~="panel"]`)   |
| `div span`                                | Descendant (span anywhere inside div)      |
| `div > span`                              | Direct child                               |
| `[style]`                                 | Attribute presence                         |
| `input[type=hidden]`                      | Attribute value (exact)                    |
| `[src^="prefix/"]`                        | Attribute starts with                      |
| `[href*="substring"]`                     | Attribute contains                         |
| `[src$=".png"]`                           | Attribute ends with                        |
| `[class~="warning"]`                      | Attribute contains whitespace-token        |
| `img:not([alt])`                          | Negated attribute / class / id             |
| `{{foo}}`                                 | Escaped variable `{{foo}}`                 |
| `{{data.foo}}`                            | Variable with a dotted path                |
| `{{{foo}}}`                               | Triple / unescaped variable                |
| `{{options.*}}`                           | Variable path prefix match                 |
| `{{*.deprecated}}`                        | Variable path suffix match                 |
| `{{*}}`                                   | Any escaped variable                       |
| `{{{*}}}`                                 | Any triple                                 |
| `{{#items}}`                              | Section `{{#items}}...{{/items}}`          |
| `{{^items}}`                              | Inverted section `{{^items}}...{{/items}}` |
| `{{#items}} > li`                         | Direct child inside a section              |
| `{{!TODO}}`                               | Comment with exact content                 |
| `{{!*TODO*}}`                             | Comment containing "TODO"                  |
| `{{>header}}`                             | Partial invocation                         |
| `{{>legacy_*}}`                           | Partial name prefix                        |
| `pl-multiple-choice:has({{foo}})`         | Element containing a given variable        |
| `pl-multiple-choice:not(:has(pl-answer))` | Element missing a required descendant      |
| `div, span`                               | Comma-separated alternatives               |
| `:root`                                   | The document root (the whole parse tree)   |
| `:root:has(pl-answer-panel)`              | Document contains a descendant anywhere    |
| `:root:not(:has(pl-answer-panel))`        | Document is missing a descendant anywhere  |
| `:root > section`                         | Top-level element (direct child of root)   |

The `>` (child) combinator is kind-transparent: `div > span` matches even if a Mustache section sits between them (e.g. `<div>{{#show}}<span>{{/show}}</div>`), and `{{#a}} > {{#b}}` matches across intervening HTML elements. `{{#foo}}` matches only positive sections — to target inverted sections use `{{^foo}}`.

**Document-scoped conditional rules.** Use `:root` with `:has(...)` / `:not(:has(...))` to express rules that depend on the overall document. Chained `:has(...)` acts as AND, so you can combine "contains X" and "missing Y" in one selector:

```jsonc
{
  "id": "question-needs-answer-panel",
  "selector": ":root:has(pl-question-panel):not(:has(pl-answer-panel))",
  "message": "A question-panel document must also declare a pl-answer-panel.",
}
```

When `:root` matches, the diagnostic is reported at the start of the document (row 0, column 0) so the squiggle doesn't span the whole file. `:root` here is the tree-sitter fragment root, so it works on partial templates and fragments — unlike browser CSS, which anchors `:root` on `<html>`. Inside `:has(...)`, `:root` refers to the element being has-checked, not the document.

### Disabling Lint Rules

Disable a lint rule for an entire file with an inline comment:

```html
<!-- htmlmustache-disable preferMustacheComments -->
{{! htmlmustache-disable selfClosingNonVoidTags }}
```

The comment can appear anywhere in the file. Both built-in and custom rules can be disabled by name/id. Use multiple comments to disable multiple rules.

### EditorConfig

Both the CLI and VS Code extension respect your `.editorconfig` file for indentation settings (`indent_style`, `indent_size`). EditorConfig values override `.htmlmustache.jsonc` for indentation, and CLI flags override everything.

**Priority order:** defaults < `.htmlmustache.jsonc` < `.editorconfig` (indent only) < CLI flags

## Acknowledgments

This project is based on [tree-sitter-html](https://github.com/tree-sitter/tree-sitter-html) by Max Brunsfeld and Amaan Qureshi.
