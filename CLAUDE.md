# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A tree-sitter grammar for HTML with Mustache template syntax (`{{...}}`, `{{#...}}`, `{{/...}}`, `{{^...}}`, `{{{...}}}`, `{{!...}}`, `{{>...}}`) embedded within HTML. The repo also ships a parser entry, a linter, a formatter, a CLI, and a VS Code LSP extension.

## Common Commands

```bash
# Tree-sitter grammar
tree-sitter generate              # Regenerate src/parser.c + src/node-types.json from grammar.js
tree-sitter test                  # Run the parser test suite (test/corpus/*.txt)
tree-sitter test -f "pattern"     # Filter to specific corpus tests
pnpm run build                    # Build the .wasm
pnpm start                        # Build .wasm + open the playground

# JS entry points (parser, linter, formatter, CLI)
pnpm run generate:ast-types       # Regenerate js/parser/nodeTypes.generated.ts from src/node-types.json
pnpm run build:js                 # esbuild + tsc emit into dist/
pnpm run typecheck                # tsc -p js/tsconfig.json --noEmit
pnpm run test:js                  # vitest run (picks up js/**/*.test.ts)
pnpm run lint                     # eslint over everything
pnpm run format:check             # prettier dry-run

# Node native binding tests
pnpm test                         # tree-sitter test + bindings/node/*_test.js
```

### LSP development (in `lsp/`)

```bash
cd lsp
pnpm install
pnpm run build        # Build the extension (esbuild + WASM copy)
pnpm run test         # LSP server vitest
pnpm run typecheck    # tsc --noEmit for client + server
pnpm run lint
```

## Architecture

### Four shipped components

1. **Tree-sitter grammar** (root): `grammar.js` + `src/scanner.c`. Generates `src/parser.c`, `src/node-types.json`, etc. Published as `@reteps/tree-sitter-htmlmustache` (the `.` subpath of the package is the native binding via `bindings/node`).
2. **JS API** (`js/`): three subpath exports — `./parser`, `./linter`, `./formatter` — each backed by web-tree-sitter (wasm). Built into `dist/<entry>/`.
3. **CLI** (`js/cli/`, bin `htmlmustache`): wraps the linter and formatter with config-file + glob discovery. Bin path is `dist/cli/main.js`.
4. **LSP server + VS Code extension** (`lsp/`): separate pnpm workspace. Imports from `js/` via relative paths.

### Tree-sitter grammar files (in `src/`, tree-sitter-owned)

- `grammar.js` (root): grammar DSL combining HTML and Mustache rules.
- `src/scanner.c`: external scanner. Maintains two stacks — `tags` (HTML) and `mustache_tags` (Mustache sections) — to support cross-grammar implicit closures.
- `src/tag.h`: HTML tag containment rules.
- `src/mustache_tag.h`: Mustache section tracking with `html_tag_stack_size` for the cross-grammar implicit-end-tag mechanism.
- `src/custom_raw_tags.h`: compile-time list of tags whose content is parsed as raw text.
- `src/parser.c`, `src/tree_sitter/parser.h`, `src/node-types.json`, `src/grammar.json`: generated. Don't hand-edit. After `tree-sitter generate`, regenerate AST types with `pnpm run generate:ast-types`.

#### Key design: cross-grammar implicit end tags

When `{{/...}}` closes, it may implicitly close HTML tags opened within the section. The scanner records `html_tag_stack_size` at the section's `{{#...}}` so it knows how many HTML tags to pop. This makes patterns like the following parse correctly:

```html
{{#items}}
<li>{{name}}{{/items}}</li>
```

### JS layout (`js/`)

```
js/
  parser/      # ./parser entry — typed JSON AST + walk
    index.ts
    nodeTypes.generated.ts   # GENERATED from src/node-types.json
    parser.test.ts
  linter/      # ./linter entry — lint() + rule engine + checkers
    index.ts, collectErrors.ts, mustacheChecks.ts,
    htmlBalanceChecker.ts, customRuleFilter.ts,
    customTagSchemaChecker.ts, selectorMatcher.ts,
    diagnostic.ts, linter.test.ts
  formatter/   # ./formatter entry — format() + IR pipeline + EditorConfig
    index.ts, document.ts, classifier.ts, formatters.ts,
    printer.ts, ir.ts, mergeOptions.ts, embedded.ts,
    embeddedRegions.ts, editorconfig.ts, utils.ts, formatter.test.ts
  shared/      # Types and helpers used by 2+ entries (or by CLI + LSP)
    grammar.ts, nodeHelpers.ts, configSchema.ts, configFile.ts,
    customCodeTags.ts, customTagSchemaLoader.ts, ruleMetadata.ts,
    cssDisplay.ts
  cli/         # CLI binary
    main.ts, check.ts, format.ts, wasm.ts, *.test.ts
  tsconfig.json
```

### Typed AST via codegen

`scripts/generate-ast-types.ts` reads `src/node-types.json` (emitted by `tree-sitter generate`) and writes `js/parser/nodeTypes.generated.ts`. The output is a discriminated union: one `BaseNode<T, Children>` per named grammar rule, plus a `SyntaxNode` union. Hidden rules (named with a leading `_`) are filtered out.

Switching on `node.type` narrows the node's `children` array to the exact set of allowed children. Don't hand-edit `nodeTypes.generated.ts` — regenerate via `pnpm run generate:ast-types` after any grammar change.

### Formatter pipeline

The formatter (`js/formatter/`) is a Prettier-inspired IR pipeline:

1. **Classifier** (`classifier.ts`): maps syntax nodes to CSS-`display`-like categories. Uses `CSSDisplay` from `js/shared/cssDisplay.ts`.
2. **AST → IR** (`formatters.ts`): walks the tree, building a `Doc` from `ir.ts`.
3. **IR → string** (`printer.ts`): renders `Doc` to text with indentation.
   Embedded `<script>` / `<style>` / custom code-tag bodies are extracted by `embeddedRegions.ts` and reformatted via an injected `prettier` (peer dep) by `embedded.ts`.

### LSP

The LSP server (`lsp/server/src/`) uses web-tree-sitter (wasm) and imports the rule engine + formatter from `../../../js/{shared,linter,formatter}/`. Key modules:

- **`server.ts`**: top-level LSP plumbing.
- **`diagnostics.ts`**: parse errors + lint diagnostics via `js/linter`.
- **`embeddedTokenizer.ts`**: TextMate-grammar-based syntax highlighting for embedded code regions (uses `vscode-textmate` + `vscode-oniguruma`).
- **`semanticTokens.ts`**: full semantic-token provider using tree-sitter highlight queries.

### Tests

- `test/corpus/*.txt`: tree-sitter parser corpus.
- `bindings/node/*_test.js`: Node-native binding smoke tests.
- `js/**/*.test.ts`: vitest, run via `pnpm run test:js`. Picked up by root `vitest.config.ts`.
- `lsp/server/test/**/*.test.ts`: LSP vitest, separate workspace.

### Query files

- `queries/highlights.scm`: syntax highlighting.
- `queries/injections.scm`: language injections (script/style content).

## Development workflow

1. Modify `grammar.js` or `src/scanner.c`.
2. `tree-sitter generate` — regenerates `src/parser.c`, `src/node-types.json`, etc.
3. `pnpm run generate:ast-types` — propagates grammar changes into `js/parser/nodeTypes.generated.ts`.
4. `tree-sitter test` — corpus tests.
5. `pnpm run build` — rebuild the wasm (LSP + js entries both load it).
6. `pnpm run test:js` and `pnpm --prefix lsp/server run test` — runtime tests.
7. `pnpm run typecheck` and `pnpm --prefix lsp run typecheck` — type safety.

The LSP depends on `tree-sitter-htmlmustache.wasm` (built via `pnpm run build`). Rebuild after grammar changes before testing LSP features.

Package manager: `pnpm`. `lsp/` is a separate workspace with its own client + server. Node 22.

## Public package exports

| Subpath       | Purpose                                                     |
| ------------- | ----------------------------------------------------------- |
| `.`           | Native tree-sitter binding (`bindings/node`)                |
| `./parser`    | `createParser({ locateWasm })` → typed JSON AST + `walk`    |
| `./linter`    | `createLinter({ locateWasm })` → `lint(source, config)`     |
| `./formatter` | `createFormatter({ locateWasm, prettier })` → `format(...)` |
| `./wasm`      | Direct URL to `tree-sitter-htmlmustache.wasm`               |

See `docs/adr/0001-restructure-js-entry-points.md` for the rationale behind the split.
