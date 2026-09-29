# Repository guidance

## Generated sources

Do not hand-edit `src/parser.c`, `src/grammar.json`, `src/node-types.json`, `src/tree_sitter/*`, or `js/parser/nodeTypes.generated.ts`.

After changing the grammar, run these commands from the repository root and include the generated changes with the source changes:

```bash
pnpm exec tree-sitter generate
pnpm run generate:ast-types
```

## Build and implementation boundaries

- After parser or scanner changes, run `pnpm build` before JavaScript or LSP tests so they use the updated grammar WASM.
- The extension build (`pnpm --dir lsp run build`) copies the root grammar WASM; it does not rebuild it.
- Put shared linting and formatting behavior in `js/`, where both the CLI and LSP can use it. Keep integration-specific code in the corresponding CLI or LSP layer.

## Further guidance

- [README: Publishing new versions](README.md#publishing-new-versions)
- [LSP development](lsp/README.md)
- [Project terminology](CONTEXT.md)
