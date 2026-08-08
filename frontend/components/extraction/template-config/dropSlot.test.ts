/**
 * Pure drop-slot resolution (B-6 T6, panel decision 6): a drag gesture's
 * endpoints become the dispatcher's landing slot — or null for a no-op
 * drop. Only the DOM gesture itself is left to the real-browser pass;
 * every landing rule is pinned here.
 */
import {describe, expect, it} from 'vitest';

import {resolveDropSlot} from './dropSlot';
import {buildTemplateTree} from './templateTree';

const field = (id: string, entityTypeId: string, sortOrder: number) => ({
  id,
  entity_type_id: entityTypeId,
  name: `k_${id}`,
  label: id.toUpperCase(),
  field_type: 'text',
  sort_order: sortOrder,
});

const tree = buildTemplateTree(
  [
    {id: 'sec1', name: 'basics', label: 'Basics', sort_order: 1},
    {id: 'grp', name: 'models', label: 'Models', role: 'model_container', sort_order: 2},
    {id: 'child', name: 'perf', label: 'Performance', parent_entity_type_id: 'grp', sort_order: 3},
  ],
  [
    field('f1', 'sec1', 1),
    field('f2', 'sec1', 2),
    field('f3', 'sec1', 3),
    field('g1', 'grp', 1),
    field('c1', 'child', 1),
    field('c2', 'child', 2),
  ],
);

const none: ReadonlySet<string> = new Set();

const resolve = (
  activeId: string,
  overId: string | null,
  over: {collapsed?: ReadonlySet<string>; isFiltering?: boolean; pendingIds?: ReadonlySet<string>} = {},
) =>
  resolveDropSlot({
    sections: tree,
    activeId,
    overId,
    collapsed: over.collapsed ?? none,
    isFiltering: over.isFiltering ?? false,
    pendingIds: over.pendingIds ?? none,
  });

describe('resolveDropSlot — over a field row', () => {
  it('lands at the over-row index within the same section (arrayMove semantics, downward)', () => {
    expect(resolve('f1', 'f3')).toEqual({toSectionId: 'sec1', toIndex: 2});
  });

  it('lands at the over-row index within the same section (upward)', () => {
    expect(resolve('f3', 'f1')).toEqual({toSectionId: 'sec1', toIndex: 0});
  });

  it('crossing sections inserts BEFORE the over-row', () => {
    expect(resolve('f1', 'c2')).toEqual({toSectionId: 'child', toIndex: 1});
  });

  it('resolves rows living in a group child section', () => {
    expect(resolve('c1', 'f2')).toEqual({toSectionId: 'sec1', toIndex: 1});
  });
});

describe('resolveDropSlot — over a section header', () => {
  it('a COLLAPSED header lands at that section END (its rows are invisible)', () => {
    expect(resolve('f1', 'child', {collapsed: new Set(['child'])})).toEqual({
      toSectionId: 'child',
      toIndex: 2,
    });
  });

  it('an EXPANDED header lands at the TOP slot (the header sits above the first field)', () => {
    expect(resolve('f1', 'child')).toEqual({toSectionId: 'child', toIndex: 0});
  });

  it('a collapsed GROUP header lands at the end of the group own fields', () => {
    expect(resolve('f1', 'grp', {collapsed: new Set(['grp'])})).toEqual({
      toSectionId: 'grp',
      toIndex: 1,
    });
  });
});

describe('resolveDropSlot — no-op drops', () => {
  it('over the dragged row itself is null', () => {
    expect(resolve('f2', 'f2')).toBeNull();
  });

  it('released over nothing is null', () => {
    expect(resolve('f2', null)).toBeNull();
  });

  it('an unknown over id is null', () => {
    expect(resolve('f2', 'nowhere')).toBeNull();
  });
});

describe('resolveDropSlot — guards (defense in depth behind the disabled handles)', () => {
  it('null while filtering — visible indices lie about true positions', () => {
    expect(resolve('f1', 'f3', {isFiltering: true})).toBeNull();
  });

  it('null for a pending active row — no server id to write', () => {
    expect(resolve('f1', 'f3', {pendingIds: new Set(['f1'])})).toBeNull();
  });
});
