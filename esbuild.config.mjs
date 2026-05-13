/**
 * Single-config build for every JS entry shipped from this package:
 * parser, linter, formatter, and the CLI binary. All emit ESM bundles to
 * `dist/<entry>/index.{mjs,js}`. Types are emitted separately by
 * `tsc -p js/tsconfig.json`.
 *
 * `web-tree-sitter`, `prettier`, and `vscode-languageserver-textdocument`
 * stay external — consumers install them themselves (or omit, since they're
 * peer/optional). `chalk` and `ajv` ship bundled into the entries that use
 * them.
 */

import { build } from 'esbuild';

const SHARED_EXTERNALS = [
  'web-tree-sitter',
  'prettier',
  'vscode-languageserver-textdocument',
];

await Promise.all([
  build({
    entryPoints: ['js/parser/index.ts'],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    outfile: 'dist/parser/index.mjs',
    external: SHARED_EXTERNALS,
    sourcemap: true,
  }),
  build({
    entryPoints: ['js/linter/index.ts'],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    outfile: 'dist/linter/index.mjs',
    external: SHARED_EXTERNALS,
    sourcemap: true,
  }),
  build({
    entryPoints: ['js/formatter/index.ts'],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    outfile: 'dist/formatter/index.mjs',
    external: SHARED_EXTERNALS,
    sourcemap: true,
  }),
  build({
    entryPoints: ['js/cli/main.ts'],
    bundle: true,
    platform: 'node',
    // CommonJS so `__dirname` (used to locate the bundled .wasm) and the
    // synchronous `require()` calls inside CJS deps like `editorconfig` keep
    // working. The package.json has no `"type": "module"`, so `.js` is CJS
    // by default and the bin runs without surprises.
    format: 'cjs',
    target: 'node22',
    outfile: 'dist/cli/main.js',
    sourcemap: true,
    external: [
      ...SHARED_EXTERNALS,
      'ajv',
      'ajv-errors',
      'ajv-i18n/*',
      'chalk',
      'editorconfig',
    ],
    banner: { js: '#!/usr/bin/env node' },
  }),
]);
