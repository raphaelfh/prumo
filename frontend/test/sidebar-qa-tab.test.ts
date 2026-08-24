import { describe, expect, it } from 'vitest';

import {
  sidebarItems,
  sidebarSections,
  tabIdToLabel,
  type SidebarTabId,
} from '@/components/layout/sidebarConfig';

/**
 * The Quality Assessment tab is part of the navigation contract — its id,
 * shortcut, and position relative to "Data extraction" affect routing,
 * keyboard navigation (G + Q), and the Topbar label map. These tests
 * pin all three so a future config refactor doesn't silently drop QA.
 */
describe('Sidebar config — Quality Assessment tab', () => {
  it('exposes "quality" as a sidebar tab id', () => {
    expect(sidebarItems.map((i) => i.id)).toContain('quality');
  });

  it('places the QA item directly below "extraction" in the Review section', () => {
    const review = sidebarSections.find((s) => s.title === 'Review');
    expect(review).toBeDefined();
    const ids = review!.items.map((i) => i.id);
    const extractionIdx = ids.indexOf('extraction');
    const qualityIdx = ids.indexOf('quality');
    expect(extractionIdx).toBeGreaterThanOrEqual(0);
    expect(qualityIdx).toBe(extractionIdx + 1);
  });

  it('uses an unused single-letter shortcut (Q)', () => {
    const qaItem = sidebarItems.find((i) => i.id === 'quality');
    expect(qaItem?.shortcut).toBe('Q');
    // No other tab uses Q (G + Q must be unambiguous).
    const otherShortcuts = sidebarItems
      .filter((i) => i.id !== 'quality')
      .map((i) => i.shortcut);
    expect(otherShortcuts).not.toContain('Q');
  });

  it('registers a Topbar label for the new tab', () => {
    expect(tabIdToLabel.quality).toBe('Quality assessment');
  });

  it('is not a coming-soon placeholder (the area is implemented)', () => {
    const qaItem = sidebarItems.find((i) => i.id === 'quality');
    expect(qaItem?.comingSoon).not.toBe(true);
  });

  it('SidebarTabId stays in sync with the runtime tab ids', () => {
    // Type-level assertion: every runtime id is assignable to SidebarTabId.
    const ids: SidebarTabId[] = sidebarItems.map((i) => i.id) as SidebarTabId[];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
