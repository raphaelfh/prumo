/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [
      './src/test/mocks/localStorage.ts',
      './src/test/setup.ts',
    ],
    css: true,
    exclude: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
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
        'src/test/',
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
      '@': path.resolve(__dirname, './src'),
    },
  },
});
