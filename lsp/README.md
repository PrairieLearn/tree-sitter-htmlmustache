# HTML Mustache Language Server

A VS Code language server for HTML with Mustache template syntax, powered by tree-sitter. It provides semantic highlighting, document symbols, hover information, and folding ranges for `.mustache`, `.hbs`, and `.handlebars` files.

## Build and Run

Run these commands from the repository root:

```bash
pnpm install
pnpm build                    # Compile the grammar to WebAssembly
pnpm --dir lsp run build       # Bundle the extension and copy its WASM assets
```

Then launch the extension in VS Code:

1. Open the `lsp/` folder in VS Code.
2. In Run and Debug, select **Launch LSP Extension** and press F5.
3. In the Extension Development Host window, open [test-files/test.mustache](test-files/test.mustache) or another template file.
4. Check syntax highlighting, the document outline, hover information, and folding.

## Development

Run the following commands from the repository root:

| Task                        | Command                               |
| --------------------------- | ------------------------------------- |
| Rebuild the extension       | `pnpm --dir lsp run build`            |
| Run server tests            | `pnpm --dir lsp test`                 |
| Watch server tests          | `pnpm --dir lsp run test:watch`       |
| Check TypeScript types      | `pnpm --dir lsp run typecheck`        |
| Lint client and server code | `pnpm --dir lsp run lint`             |
| Create a production build   | `pnpm --dir lsp run build:production` |

After changing extension code, rebuild and restart the debugging session. The launch configuration also runs the extension build before starting.

After changing `grammar.js`, regenerate the parser before rebuilding the WASM and extension:

```bash
pnpm exec tree-sitter generate
pnpm build
pnpm --dir lsp run build
```

## Troubleshooting

### Missing WASM files

Repeat both build commands in [Build and Run](#build-and-run). The root build creates `tree-sitter-htmlmustache.wasm`; the extension build copies it into `lsp/` and copies dependency WASM files into `lsp/server/out/`.

### No highlighting or language features

- Check the **HTML Mustache** channel in VS Code's Output panel for startup errors.
- Confirm the file uses a supported extension and the **HTML Mustache** language mode.
- For semantic highlighting, make sure it is enabled in VS Code settings.

## Code Layout

| Location                                           | Purpose                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| [client/src/extension.ts](client/src/extension.ts) | Activates the extension and starts the language server              |
| [server/src/server.ts](server/src/server.ts)       | Advertises capabilities and registers request handlers              |
| [server/src/parser.ts](server/src/parser.ts)       | Loads the WASM grammar and exposes parsing helpers                  |
| [server/src/](server/src/)                         | Language features such as highlighting, symbols, hover, and folding |
| [server/test/](server/test/)                       | Server tests                                                        |
| [esbuild.mjs](esbuild.mjs)                         | Bundles the client and server and copies runtime assets             |
| [package.json](package.json)                       | Extension manifest and development scripts                          |

The server parses documents when they open or change, caches their syntax trees, and uses those trees to implement language features. To add a feature, implement it in `server/src/`, register its handler and capability in `server.ts`, and add a test in `server/test/`.

## Related

- [tree-sitter-htmlmustache](../) — Grammar and shared tooling
- [VS Code LSP Guide](https://code.visualstudio.com/api/language-extensions/language-server-extension-guide)
- [web-tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web)
