import { describe, expect, it } from 'vitest';
import { runs } from '@/lib/copy/runs';

describe('runs copy — run-screen shortcut labels', () => {
  it('names the rail toggle collapse and expand, not hide and show', () => {
    expect(runs.shortcutSectionNav).toBe('Collapse / expand sections');
    expect(runs.sectionNavShow).toBe('Expand sections');
    expect(runs.sectionNavHide).toBe('Collapse sections');
  });
});
