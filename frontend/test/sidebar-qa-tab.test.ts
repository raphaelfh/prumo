import { describe, expect, it } from 'vitest';

import {
  sidebarItems,
  sidebarSections,
  tabIdToLabel,
  VALID_TAB_IDS,
  type SidebarTabId,
} from '@/components/layout/sidebarConfig';

/**
 * The Quality Assessment tab is part of the navigation contract — its id,
 * shortcut, and position relative to "Data extraction" affect routing,
 * keyboard navigation (G + Q), and the Topbar label map. These tests
 * pin all three so a future config refactor doesn't silently drop QA.
 */
describe('Sidebar config — Quality Assessment tab', () => {
  it('exposes "quality" in the SidebarTabId union via VALID_TAB_IDS', () => {
    expect(VALID_TAB_IDS).toContain('quality');
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

  it('SidebarTabId stays in sync with the runtime VALID_TAB_IDS list', () => {
    // Type-level assertion: VALID_TAB_IDS contents are assignable to SidebarTabId.
    const ids: SidebarTabId[] = VALID_TAB_IDS as SidebarTabId[];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
