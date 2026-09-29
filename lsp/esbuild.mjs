import * as esbuild from 'esbuild';
import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const production = process.argv.includes('--production');

/** @type {esbuild.BuildOptions} */
const sharedOptions = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  platform: 'node',
  target: 'node18',
  external: ['vscode'],
};

// Bundle the client (CJS for VS Code extension API)
await esbuild.build({
  ...sharedOptions,
  format: 'cjs',
  entryPoints: ['client/src/extension.ts'],
  outfile: 'client/out/extension.js',
});

// Bundle the server (ESM to support web-tree-sitter's import.meta.url)
await esbuild.build({
  ...sharedOptions,
  format: 'esm',
  entryPoints: ['server/src/server.ts'],
  outfile: 'server/out/server.mjs',
  banner: {
    js: `
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
`,
  },
});

// Resolve runtime assets through their owning packages, independent of pnpm's store layout.
const serverRequire = createRequire(
  new URL('./server/package.json', import.meta.url),
);
const editorconfigRequire = createRequire(
  serverRequire.resolve('editorconfig'),
);
for (const [source, destination] of [
  ['../tree-sitter-htmlmustache.wasm', 'tree-sitter-htmlmustache.wasm'],
  [
    serverRequire.resolve('web-tree-sitter/web-tree-sitter.wasm'),
    'server/out/web-tree-sitter.wasm',
  ],
  [
    editorconfigRequire.resolve('@one-ini/wasm/one_ini_bg.wasm'),
    'server/out/one_ini_bg.wasm',
  ],
  [
    serverRequire.resolve('vscode-oniguruma/release/onig.wasm'),
    'server/out/onig.wasm',
  ],
]) {
  copyFileSync(source, destination);
}

console.log('Build complete');
