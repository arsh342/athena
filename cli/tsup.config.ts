import { cpSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node18',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  bundle: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  minify: false,
  // core uses import.meta.url (createRequire for the grammar package); shim it in the CJS bundle.
  shims: true,
  noExternal: ['@athena/core', '@athena/agents', 'commander'],
  external: [
    // Optional scanner dependencies should resolve at runtime, not from bundle shims.
    'eslint',
    'eslint-plugin-security',
    'jiti',
    'jiti/package.json',
    // Grammar .wasm files are resolved from node_modules at runtime.
    '@vscode/tree-sitter-wasm',
    // Provider SDKs for the optional AI layer: loaded only when --ai is used.
    '@anthropic-ai/sdk',
    'openai',
    '@google/genai',
  ],
  // The fast detector's weights ship next to the bundle (dist/models/fast).
  onSuccess: async () => {
    cpSync('../core/models', 'dist/models', { recursive: true });
    cpSync('../core/skills', 'dist/skills', { recursive: true });
    cpSync('../core/src/deps/data', 'dist/data', { recursive: true });
  },
  outExtension() {
    return {
      js: '.cjs',
    };
  },
});
