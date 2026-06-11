/// <reference types="vitest" />
import {defineConfig} from 'vite';
import {reactWithCompiler} from './vite.shared-plugins';
import path from 'path';

export default defineConfig({
  plugins: reactWithCompiler(),
  // Vite 8 denies serving files outside the workspace root by default; tests
  // that import pdfjs-dist's worker via `?url` (frontend/lib/pdf-worker.ts)
  // hit that gate because the worker mjs lives under node_modules. Relaxing
  // strict here lets vitest resolve the asset URL the same way the browser
  // build does.
  server: {
    fs: {
      strict: false,
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [
        './frontend/test/mocks/localStorage.ts',
        './frontend/test/setup.ts',
    ],
    css: true,
    exclude: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '.claude/worktrees/**',
      // Excluir testes de Edge Functions (Deno) - devem ser executados com deno test
      'supabase/functions/**/*.test.ts',
      'supabase/functions/**/*.spec.ts',
      'supabase/functions/**/tests/**',
      // Excluir testes de bibliotecas em node_modules
      '**/node_modules/**/*.test.*',
      '**/node_modules/**/*.spec.*',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
          'frontend/test/',
        '**/*.d.ts',
        '**/*.config.*',
        'dist/',
        'build/',
        'coverage/',
        '**/*.test.*',
        '**/*.spec.*',
      ],
      thresholds: {
        global: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70,
        },
      },
    },
  },
  resolve: {
    alias: {
        '@': path.resolve(__dirname, './frontend'),
        '@prumo/pdf-viewer': path.resolve(__dirname, './frontend/pdf-viewer/index.ts'),
    },
  },
});
