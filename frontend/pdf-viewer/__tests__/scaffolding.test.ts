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

describe('@prumo/pdf-viewer public API', () => {
  it('exports the runtime entry points from the package root', async () => {
    const mod = await import('@prumo/pdf-viewer');
    expect(typeof mod.createViewerStore).toBe('function');
    expect(typeof mod.ViewerProvider).toBe('function');
    expect(typeof mod.useViewerStore).toBe('function');
    expect(typeof mod.useViewerStoreApi).toBe('function');
  });

  it('createViewerStore returns a store with getState/setState/subscribe', async () => {
    const {createViewerStore} = await import('@prumo/pdf-viewer');
    const store = createViewerStore();
    expect(typeof store.getState).toBe('function');
    expect(typeof store.setState).toBe('function');
    expect(typeof store.subscribe).toBe('function');
  });

  it('exports Phase 2 public API surface', async () => {
    const mod = await import('@prumo/pdf-viewer');
    // Compound primitives
    expect(typeof mod.Viewer).toBe('object');
    expect(typeof mod.Viewer.Root).toBe('function');
    expect(typeof mod.Viewer.Body).toBe('function');
    expect(typeof mod.Viewer.Pages).toBe('function');
    expect(typeof mod.Viewer.Page).toBe('function');
    expect(typeof mod.CanvasLayer).toBe('function');
    expect(typeof mod.TextLayer).toBe('function');
    // UI components
    expect(typeof mod.Toolbar).toBe('function');
    expect(typeof mod.NavigationControls).toBe('function');
    expect(typeof mod.ZoomControls).toBe('function');
    expect(typeof mod.LoadingState).toBe('function');
    expect(typeof mod.ErrorState).toBe('function');
    // Hooks
    expect(typeof mod.useDocumentLoader).toBe('function');
    expect(typeof mod.usePageHandle).toBe('function');
    // High-level component
    expect(typeof mod.PrumoPdfViewer).toBe('function');
  });
});
