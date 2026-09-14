import { describe, expect, it } from 'vitest';
import { runs } from '@/lib/copy/runs';
import { RUN_SHORTCUTS } from '@/lib/runs/shortcuts';

describe('runs copy — run-screen shortcut labels', () => {
  it('names the rail toggle collapse and expand, not hide and show', () => {
    expect(runs.shortcutSectionNav).toBe('Collapse / expand sections');
    expect(runs.sectionNavShow).toBe('Expand sections');
    expect(runs.sectionNavHide).toBe('Collapse sections');
  });

  it('names the pager previous first, like the chevrons', () => {
    // The header renders ‹ before ›, so the label and the combo read previous → next.
    expect(runs.shortcutNextPrev).toBe('Previous / next article');
    expect(RUN_SHORTCUTS.find((s) => s.id === 'nextPrev')?.combo).toBe('[ / ]');
  });
});
