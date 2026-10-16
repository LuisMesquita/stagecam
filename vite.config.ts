import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';

const web = resolve(import.meta.dirname, 'web');

export default defineConfig({
  root: web,
  appType: 'mpa',
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        director: resolve(web, 'director.html'),
        cam: resolve(web, 'cam.html'),
        output: resolve(web, 'output.html'),
      },
    },
  },
  test: {
    root: import.meta.dirname,
    include: ['tests/**/*.test.ts'],
  },
  lint: {
    ignorePatterns: ['dist/**', 'node_modules/**'],
  },
  fmt: {
    singleQuote: true,
    printWidth: 100,
    ignorePatterns: ['dist/**', 'data/**'],
  },
});
