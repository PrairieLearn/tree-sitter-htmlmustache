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
| `unescapedEntities`            | `warning` | Flags unescaped `&` and `>` characters in text content                        |
| `preferMustacheComments`       | `off`     | Suggests replacing HTML comments with mustache comments                       |
| `unrecognizedHtmlTags`         | `error`   | Flags HTML tags that are not standard HTML elements or valid custom elements  |
| `elementContentTooLong`        | `off`     | Flags configured elements whose inner content exceeds a byte-length threshold |
| `customTagSchema`              | `error`   | Validates configured custom tags against their JSON Schema contracts          |

<!-- RULES_TABLE_END -->

### Tag Schemas

Custom tags can declare a JSON Schema draft 2020-12 contract. The schema may be inline or a path resolved relative to `.htmlmustache.jsonc`:

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

Schemas validate this value shape:

```jsonc
{
  "tag": "pl-multiple-choice",
  "attributes": { "answers-name": "q1", "weight": "2" },
  "children": [{ "tag": "pl-answer", "attributes": { "correct": "true" } }],
}
```

Attribute values are coerced by JSON Schema (`"2"` can satisfy an integer, boolean attributes become `true`). Attribute values containing mustache are treated as unknown runtime values, so value-dependent schema errors are waived while presence and unknown-attribute checks still run. Mustache sections are flattened when building `children`, so children inside `{{#section}}...{{/section}}` count as reachable; timeline-aware child counts are not modeled yet.

Set `"htmlGlobalAttributes": true` on an `attributes` sub-schema to permit the WHATWG HTML global attributes (sourced from [`html-element-attributes`](https://github.com/wooorm/html-element-attributes) — `class`, `id`, `style`, `hidden`, `slot`, `inert`, `popover`, `contenteditable`, `spellcheck`, etc.), every `aria-*` attribute and `role` (from [`aria-attributes`](https://github.com/wooorm/aria-attributes)), and the `data-*` pattern, alongside whichever properties the schema explicitly declares:

```jsonc
{
  "type": "object",
  "properties": {
    "tag": { "const": "pl-card" },
    "attributes": {
      "type": "object",
      "htmlGlobalAttributes": true, // ← here, on the attributes sub-schema
      "properties": {
        "kind": { "enum": ["info", "warning"] },
      },
      "required": ["kind"],
      "additionalProperties": false,
    },
  },
}
```

Schema authors can still tighten any single attribute by redeclaring it under `properties` — the explicit declaration wins. Without this flag, `additionalProperties: false` would reject `<pl-card class="...">` because `class` isn't declared.

#### Diagnostics

Schema diagnostics are phrased in HTML/element terms rather than JSON-Schema vocabulary, so template authors aren't asked to translate `instancePath` and `additionalProperty` back into the markup they wrote. Examples:

| Schema constraint                              | Diagnostic                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `attributes.required: ["answers-name"]`        | `<pl-multiple-choice> is missing required attribute "answers-name".`                 |
| `attributes.additionalProperties: false`       | `Unknown attribute "extra" on <pl-multiple-choice>.`                                 |
| `attributes.display.enum: ["block", "inline"]` | `Attribute "display" on <pl-multiple-choice> must be one of: "block", "inline".`     |
| `attributes.size.type: "integer"`              | `Attribute "size" on <pl-multiple-choice> must be integer.`                          |
| `attributes.weight.minimum: 0`                 | `Attribute "weight" on <pl-multiple-choice> must be >= 0.`                           |
| `children[].tag.const: "pl-answer"`            | `<pl-multiple-choice> only allows <pl-answer> children; found <p>.`                  |
| child `attributes.required: ["correct"]`       | `<pl-answer> child of <pl-multiple-choice> is missing required attribute "correct".` |

Constraints without a rewriter (typically `not`, `allOf`, `if`/`then`, custom keywords) fall through to ajv's localized text. Every diagnostic carries `ruleName: "customTagSchema"` and points at the element, the attribute, or the offending child — see [Disabling Lint Rules](#disabling-lint-rules) to silence them per-region.

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
