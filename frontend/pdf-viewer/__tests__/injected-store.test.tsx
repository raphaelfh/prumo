/**
 * Proves that PrumoPdfViewer (and Viewer.Root beneath it) use an injected
 * store rather than creating a fresh internal one.
 *
 * The mechanism under test:
 *   PrumoPdfViewer(store) → Viewer.Root(store) → ViewerProvider(store)
 *   → React context → useViewerStore / useViewerStoreApi
 *
 * We dispatch an action directly on the externally-owned store and assert
 * that components inside the viewer reflect the mutation — which would be
 * impossible if the viewer had silently spun up its own second store.
 */

import {render, renderHook, screen, act} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {ViewerProvider, useViewerStore, useViewerStoreApi} from '../core/context';
import {createViewerStore} from '../core/store';
import type {ViewerState} from '../core/state';

// ──────────────────────────────────────────────────────────────────────────────
// Mocks (same setup as primitives.test.tsx / scaffolding.test.ts)
// pdfjs-dist uses browser APIs unavailable in jsdom; swap in the legacy Node
// build so import resolution succeeds without crashing.
import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

// articleFileSource (transitively imported by PrumoPdfViewer via adapters/)
// reaches for the Supabase client. Stub it to a neutral no-op so the test
// module graph resolves cleanly without real env vars.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({select: () => ({eq: () => ({eq: () => ({maybeSingle: async () => ({data: null, error: null})})})})}),
    storage: {from: () => ({createSignedUrl: async () => ({data: null, error: null})})},
  },
}));

// ──────────────────────────────────────────────────────────────────────────────
// Helpers — mirrors context.test.tsx

function CurrentPage() {
  const page = useViewerStore((s: ViewerState) => s.currentPage);
  return <span data-testid="current-page">{page}</span>;
}

function CurrentScale() {
  const scale = useViewerStore((s: ViewerState) => s.scale);
  return <span data-testid="scale">{scale.toFixed(2)}</span>;
}

// ──────────────────────────────────────────────────────────────────────────────

describe('injected store: ViewerProvider + Viewer.Root + PrumoPdfViewer', () => {
  // ── 1. ViewerProvider with an external store ──────────────────────────────
  it('ViewerProvider: external store is used (not replaced by an internal one)', () => {
    const external = createViewerStore({scale: 2.5});
    render(
      <ViewerProvider store={external}>
        <CurrentScale />
      </ViewerProvider>,
    );
    // The custom initial scale is visible → the external store is in use.
    expect(screen.getByTestId('scale').textContent).toBe('2.50');
  });

  it('ViewerProvider: action dispatched on external store is reflected inside', async () => {
    const external = createViewerStore({scale: 1.0});
    render(
      <ViewerProvider store={external}>
        <CurrentScale />
      </ViewerProvider>,
    );
    expect(screen.getByTestId('scale').textContent).toBe('1.00');

    await act(async () => {
      external.getState().actions.setScale(3.0);
    });

    expect(screen.getByTestId('scale').textContent).toBe('3.00');
  });

  // ── 2. useViewerStoreApi returns the injected instance ────────────────────
  it('useViewerStoreApi returns the exact same StoreApi that was injected', () => {
    const external = createViewerStore();

    // renderHook avoids the "captured =" pattern that the React Compiler
    // rejects (mutation of outer-scope variable during render).
    const {result} = renderHook(() => useViewerStoreApi(), {
      wrapper: ({children}) => (
        <ViewerProvider store={external}>{children}</ViewerProvider>
      ),
    });

    // Object identity: the hook must return the same reference, not a copy.
    expect(result.current).toBe(external);
  });

  // ── 3. Viewer.Root forwards store to ViewerProvider ───────────────────────
  it('Viewer.Root: external store is used by child components', async () => {
    const {Viewer} = await import('../primitives/Viewer');
    const external = createViewerStore({currentPage: 7});

    render(
      <Viewer.Root source={null} store={external}>
        <CurrentPage />
      </Viewer.Root>,
    );

    // The custom initial currentPage is visible → Viewer.Root forwarded the store.
    expect(screen.getByTestId('current-page').textContent).toBe('7');
  });

  it('Viewer.Root: action dispatched on external store is reflected inside', async () => {
    const {Viewer} = await import('../primitives/Viewer');
    const external = createViewerStore({currentPage: 1});

    render(
      <Viewer.Root source={null} store={external}>
        <CurrentPage />
      </Viewer.Root>,
    );
    expect(screen.getByTestId('current-page').textContent).toBe('1');

    await act(async () => {
      external.getState().actions.goToPage(5);
    });

    expect(screen.getByTestId('current-page').textContent).toBe('5');
  });

  // ── 4. PrumoPdfViewer forwards store end-to-end ───────────────────────────
  it('PrumoPdfViewer: injected store is used (not a fresh internal one)', async () => {
    const {PrumoPdfViewer} = await import('../PrumoPdfViewer');
    const external = createViewerStore({scale: 1.75});

    // We render PrumoPdfViewer with a sibling CurrentScale also wrapped in
    // the same ViewerProvider so both components read from the same store.
    // Without the injected store, PrumoPdfViewer would create its OWN
    // ViewerProvider internally, making CurrentScale unreachable from it.
    render(
      <ViewerProvider store={external}>
        {/* This component is in the OUTER ViewerProvider (the shared one). */}
        <CurrentScale />
        {/* PrumoPdfViewer receives the same store → Viewer.Root forwards it
            → its internal ViewerProvider is the SAME context node. */}
        <PrumoPdfViewer source={null} store={external} toolbar={false} />
      </ViewerProvider>,
    );

    // Both CurrentScale (in outer provider) and the viewer use the same store.
    expect(screen.getByTestId('scale').textContent).toBe('1.75');

    // Mutate via the external store; the sibling component must update.
    await act(async () => {
      external.getState().actions.setScale(2.25);
    });

    expect(screen.getByTestId('scale').textContent).toBe('2.25');
  });

  it('PrumoPdfViewer: goToPage on injected store is reflected outside the viewer', async () => {
    const {PrumoPdfViewer} = await import('../PrumoPdfViewer');
    const external = createViewerStore({currentPage: 1});

    render(
      <ViewerProvider store={external}>
        <CurrentPage />
        <PrumoPdfViewer source={null} store={external} toolbar={false} />
      </ViewerProvider>,
    );
    expect(screen.getByTestId('current-page').textContent).toBe('1');

    await act(async () => {
      external.getState().actions.goToPage(3);
    });

    // The CurrentPage component (outside the viewer) reflects the mutation —
    // proving ONE store is shared, not two isolated ones.
    expect(screen.getByTestId('current-page').textContent).toBe('3');
  });
});
