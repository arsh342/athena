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
    // ESLint dependencies that should not be bundled
    'jiti',
    'jiti/package.json',
  ],
  outExtension() {
    return {
      js: '.cjs',
    };
  },
});
