import {describe, expect, it} from 'vitest';

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
});
