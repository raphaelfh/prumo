import {describe, expect, it, vi} from 'vitest';

// The main package entry now re-exports PrumoPdfViewer which transitively
// imports the pdfjs engine. pdfjs-dist's main build uses DOMMatrix at module
// init which is browser-only. Shim it with the legacy Node-compatible build.
import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

// articleFileSource imports the supabase client which crashes at module load
// when VITE_SUPABASE_URL is unset (test environment). Mock it to a no-op
// client; the scaffolding test only verifies surface exports, not behavior.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({select: () => ({eq: () => ({eq: () => ({maybeSingle: async () => ({data: null, error: null})})})})}),
    storage: {from: () => ({createSignedUrl: async () => ({data: null, error: null})})},
  },
}));

// Import AFTER the mocks are registered, at module scope: the `vi.mock` factory
// above closes over `legacyPdfjs`, and the package root pulls the whole viewer
// graph (pdfjs, react-markdown, katex) — seconds of transform that inside an
// `it()` is charged against `testTimeout` and flakes under parallelism.
const mod = await import('@prumo/pdf-viewer');

describe('@prumo/pdf-viewer public API', () => {
  it('exports exactly what the app imports', () => {
    expect(Object.keys(mod).sort()).toEqual([
      'PrumoPdfViewer',
      'articleFileSourceFromStorageKey',
      'createViewerStore',
      'subscribeReaderLocate',
    ]);
  });

  it('createViewerStore returns a vanilla Zustand store', () => {
    const store = mod.createViewerStore();
    expect(typeof store.getState).toBe('function');
    expect(typeof store.setState).toBe('function');
    expect(typeof store.subscribe).toBe('function');
  });
});
