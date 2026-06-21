import { describe, expect, it } from 'vitest';
import { headerChip } from './HeaderChip';

describe('headerChip', () => {
  it('emits a focusable, header-scale chip class with a coarse-pointer touch floor', () => {
    const cls = headerChip();
    expect(cls).toContain('text-header-meta');
    expect(cls).toContain('focus-visible:ring');
    expect(cls).toContain('[@media(pointer:coarse)]:h-11');
  });

  it('supports an interactive variant with hover affordance', () => {
    expect(headerChip({ interactive: true })).toContain('hover:bg-muted/60');
  });
});
