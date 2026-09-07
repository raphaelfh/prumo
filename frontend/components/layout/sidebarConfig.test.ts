/**
 * `deriveSidebarNav` is the sidebar's whole branching logic, extracted so the
 * desktop rail and the mobile drawer cannot drift: they render the same groups
 * and differ only in chrome. Testing it here is what lets Task 4's component
 * tests stay small.
 */
import {describe, expect, it} from 'vitest';
import {deriveSidebarNav, sidebarItems, workspaceSectionTitle} from './sidebarConfig';

describe('deriveSidebarNav', () => {
  it('yields one WORKSPACE group when no project is open', () => {
    const groups = deriveSidebarNav({projectId: null, activeTab: '', pathname: '/'});

    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe(workspaceSectionTitle);
    expect(groups[0].items.map((i) => i.id)).toEqual(['hub', 'settings']);
    expect(groups[0].items.map((i) => i.path)).toEqual(['/', '/settings']);
  });

  it('marks the workspace destination that matches the pathname', () => {
    const onSettings = deriveSidebarNav({projectId: null, activeTab: '', pathname: '/settings'});

    expect(onSettings[0].items.find((i) => i.id === 'settings')?.active).toBe(true);
    expect(onSettings[0].items.find((i) => i.id === 'hub')?.active).toBe(false);
  });

  it('gives the hub a G-sequence letter and Settings none', () => {
    const groups = deriveSidebarNav({projectId: null, activeTab: '', pathname: '/'});

    expect(groups[0].items.find((i) => i.id === 'hub')?.shortcut).toBe('H');
    // `⌘,` is owned by useGlobalShortcuts, not by this rail — no chip.
    expect(groups[0].items.find((i) => i.id === 'settings')?.shortcut).toBeUndefined();
  });

  it('yields the project sections, with `?tab=` paths, when a project is open', () => {
    const groups = deriveSidebarNav({projectId: 'p1', activeTab: 'extraction', pathname: '/projects/p1'});

    const items = groups.flatMap((g) => g.items);
    expect(items).toHaveLength(sidebarItems.length);
    expect(items.find((i) => i.id === 'extraction')?.path).toBe('/projects/p1?tab=extraction');
    expect(items.find((i) => i.id === 'extraction')?.active).toBe(true);
    expect(items.find((i) => i.id === 'articles')?.active).toBe(false);
    // Precondition: the workspace group is genuinely absent, not merely last.
    expect(groups.some((g) => g.title === workspaceSectionTitle)).toBe(false);
  });

  it('keeps every project item on the G prefix', () => {
    const groups = deriveSidebarNav({projectId: 'p1', activeTab: 'articles', pathname: '/projects/p1'});

    expect(groups.flatMap((g) => g.items).every((i) => typeof i.shortcut === 'string')).toBe(true);
  });
});
