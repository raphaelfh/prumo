import {describe, expect, it} from 'vitest';

describe('@prumo/pdf-viewer scaffolding', () => {
  it('exposes a version constant from the package root', async () => {
    const mod = await import('@prumo/pdf-viewer');
    expect(mod.PDF_VIEWER_MODULE_VERSION).toBe('0.0.0-phase0');
  });

  it('exposes the same constant from the core barrel via relative import', async () => {
    const mod = await import('../core');
    expect(mod.PDF_VIEWER_MODULE_VERSION).toBe('0.0.0-phase0');
  });
});
