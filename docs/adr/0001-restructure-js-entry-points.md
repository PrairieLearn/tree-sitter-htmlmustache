# 0001 — Restructure JS entry points

**Status:** accepted
**Date:** 2026-05-13

## Context

Through v0.9.x the package shipped a single `./browser` subpath export that
combined `lint()` and `format()` behind one factory. Consumers who only
wanted to parse — to build their own validators, linters, or formatters on
top of the AST — had no entry point at all and would have had to pull in the
linter just to call `tree-sitter` indirectly. The single bundle also forced
every consumer to depend on `ajv`, `editorconfig`, and (via peer) `prettier`,
even when only one of those was needed.

Internally the situation was worse:

- TypeScript source lived under `src/`, where it interleaved with the
  tree-sitter-owned C output (`src/parser.c`, `src/scanner.c`, `src/tree_sitter/`,
  `src/node-types.json`). Every `tree-sitter generate` re-touched the directory
  and made it harder to reason about what was owned by whom.
- The CLI was a parallel pnpm workspace at `cli/` with its own `node_modules`,
  `tsconfig.json`, `esbuild.mjs`, and `vitest.config.ts`. It reached into the
  LSP (`lsp/server/src/configFile.ts`, `lsp/server/src/formatting/editorconfig.ts`)
  for code that arguably belonged to neither.
- The LSP server reached back into the linter via `../../../src/core/...`
  relative imports — over a dozen files, each fragile to layout changes.
- The output tree had redundant nesting: `browser/out/browser/index.mjs`.

A user request to expose the parser as its own JSON-AST entry forced the
question: add a fourth orphan directory (`parser/out/parser/...`) to the
existing pattern, or fix the pattern. We chose to fix it.

## Decision

### Source layout

All TypeScript lives under `js/`, organized by audience rather than module
family:

```
js/
  parser/      # public ./parser entry — typed JSON AST + walk
  linter/     # public ./linter entry — lint() + rule engine
  formatter/  # public ./formatter entry — format() + IR pipeline
  shared/     # types and helpers used by 2+ of the above
  cli/        # CLI binary (was cli/src/, now collapsed into the main tree)
  tsconfig.json
```

`src/` is now exclusively tree-sitter-owned: `grammar.json`, `node-types.json`,
`parser.c`, `scanner.c`, and `tree_sitter/parser.h`. Nothing in `src/` is
hand-edited TypeScript any more.

The CLI no longer has its own workspace. Files moved from `cli/src/` to
`js/cli/`. The `cli/` directory itself is gone, along with its
`node_modules`, `esbuild.mjs`, `tsconfig.json`, and `vitest.config.ts`.

### Public entries

The `./browser` subpath is removed. In its place:

| Subpath        | Purpose                                                      | Runtime deps             |
| -------------- | ------------------------------------------------------------ | ------------------------ |
| `.`            | Native tree-sitter binding (unchanged)                       | `node-addon-api`         |
| `./parser`     | `createParser({ locateWasm })` → typed JSON AST + `walk`     | `web-tree-sitter`        |
| `./linter`     | `createLinter({ locateWasm })` → `lint(source, config)`      | `web-tree-sitter`, `ajv` |
| `./formatter`  | `createFormatter({ locateWasm, prettier })` → `format(...)`  | `web-tree-sitter`, peer `prettier` |
| `./wasm`       | Direct URL to the grammar wasm                                | —                        |

Each entry is a separate esbuild bundle; consumers pay only for the parts
they import.

### Typed AST via codegen

The parser entry exposes a discriminated union: one `BaseNode<T, Children>`
per named grammar rule, plus a `SyntaxNode` union of all of them. Switching
on `node.type` narrows `node.children` to exactly the allowed child shapes.

The union is **generated** from `src/node-types.json` (which `tree-sitter
generate` writes alongside `parser.c`) by `scripts/generate-ast-types.ts`.
The generated file lives at `js/parser/nodeTypes.generated.ts` and is
checked in. Whenever the grammar changes, the generator runs (as part of
`pnpm run generate:ast-types` or `pnpm prepack`) and the types stay in lock
step with the grammar — no hand maintenance.

### Build

A single `esbuild.config.mjs` at the repo root produces all four bundles
in parallel (`parser`, `linter`, `formatter`, `cli`) into `dist/<entry>/`.
Type declarations come from one `tsc -p js/tsconfig.json` invocation. The
old per-entry esbuild + tsconfig pairs are gone.

### Tests

`vitest.config.ts` at the root picks up `js/**/*.test.ts`. The CLI's
`vitest.config.ts` is gone. LSP tests remain in their own workspace under
`lsp/server/test/`.

### `customCodeTags` → cross-cutting

The `CSSDisplay` type moved from `js/formatter/classifier.ts` into a new
`js/shared/cssDisplay.ts` so that `shared/configSchema.ts` and
`shared/customCodeTags.ts` (both used by linter, formatter, and consumers)
can reference it without depending on the formatter.

### LSP

The LSP server's relative imports were repointed from `../../../src/core/...`
to `../../../js/{shared,linter,formatter}/...`. Two former LSP-internal
modules — `configFile.ts` and `formatting/editorconfig.ts` — moved into
`js/shared/` and `js/formatter/` respectively, because the CLI already
depended on them and they had no LSP-specific behaviour. LSP imports both
through their new locations.

## Consequences

### Positive

- `./parser` is now a first-class entry. Downstream linters/validators can
  consume a fully-typed JSON AST without depending on linter or formatter
  code.
- Three independent bundles. Tree-shakers and `ajv`-averse browser
  consumers benefit immediately.
- `src/` is no longer a shared driveway. `tree-sitter generate` and TS
  development stop colliding.
- The CLI's removed workspace eliminates one source of pnpm install
  weirdness and lets it share dev-deps with everything else.
- `SyntaxNode` narrows on `type`. Code-completion suggests `children` types
  per parent. Renaming or adding a grammar node fails the build until
  consumers update.

### Negative — this is a **breaking release**

- `import { createLinter } from '@reteps/tree-sitter-htmlmustache/browser'`
  no longer resolves. Consumers must migrate to `./linter` and `./formatter`.
- The shape of the linter handle changed: it used to expose both `lint` and
  `format`; it now exposes only `lint`. Use `createFormatter` for `format`.
- `cli/out/main.js` (old bin path) is gone. The `htmlmustache` CLI now
  points to `dist/cli/main.js`. Anyone running it from a `node_modules/.bin`
  shim is unaffected; anyone hard-coding the path needs to update.
- The package version is bumped to **0.10.0** to signal the break (pre-1.0
  semver convention: minor bump = breaking).

### Followups not done in this commit

- `./wasm` is provided as a shorter alias alongside the existing
  `./tree-sitter-htmlmustache.wasm` subpath; the long form is retained for
  one cycle for tools that hard-code it. The long form can be dropped in
  the next major.
- Codegen of `NodeType` could be extended to also emit a JSON-Schema
  describing each node type, useful for cross-language tooling. Out of
  scope here.
