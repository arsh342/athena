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
  noExternal: ['@athena/core', 'commander'],
  external: [
    // Optional scanner dependencies should resolve at runtime, not from bundle shims.
    'eslint',
    'eslint-plugin-security',
    'jiti',
    'jiti/package.json',
  ],
  outExtension() {
    return {
      js: '.cjs',
    };
  },
});
