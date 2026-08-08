/**
 * Pure move/reorder planning (B-6 T3): `planFieldMove` turns a landing
 * slot (from the cell model's `moveRow` effect, the T4 combobox, or a
 * T5 undo) into the exact write batch — a whole-section renumber, plus
 * the moved row's `moveField` args when the move crosses sections. The
 * working-order input/output pair is what lets the panel dispatcher
 * serialize bursts: each dispatch plans from the order the PREVIOUS
 * dispatch produced, never from a stale tree.
 */
import {describe, expect, it} from 'vitest';

import {applySectionOrder, deriveSectionOrder, planFieldMove} from './fieldMove';
import {buildTemplateTree, findSection} from './templateTree';

const none: ReadonlySet<string> = new Set();

const order: ReadonlyMap<string, readonly string[]> = new Map([
  ['sec1', ['a', 'b', 'c']],
  ['sec2', ['d']],
]);

const plan = (
  fieldId: string,
  toSectionId: string,
  toIndex: number,
  over: {appendToEnd?: boolean; pendingIds?: ReadonlySet<string>} = {},
) =>
  planFieldMove({
    order,
    fieldId,
    toSectionId,
    toIndex,
    appendToEnd: over.appendToEnd ?? false,
    pendingIds: over.pendingIds ?? none,
  });

describe('deriveSectionOrder', () => {
  it('maps every section — child sections included — to its field ids in order', () => {
    const tree = buildTemplateTree(
      [
        {id: 's1', name: 's', label: 'S', sort_order: 1},
        {id: 'g1', name: 'g', label: 'G', role: 'model_container', sort_order: 2},
        {id: 'c1', name: 'c', label: 'C', parent_entity_type_id: 'g1', sort_order: 1},
      ],
      [
        {id: 'f2', entity_type_id: 's1', name: 'k2', label: 'B', field_type: 'text', sort_order: 2},
        {id: 'f1', entity_type_id: 's1', name: 'k1', label: 'A', field_type: 'text', sort_order: 1},
        {id: 'f3', entity_type_id: 'c1', name: 'k3', label: 'C', field_type: 'text', sort_order: 1},
      ],
    );
    const derived = deriveSectionOrder(tree);
    expect(derived.get('s1')).toEqual(['f1', 'f2']);
    expect(derived.get('g1')).toEqual([]);
    expect(derived.get('c1')).toEqual(['f3']);
  });
});

describe('planFieldMove — within-section reorder', () => {
  it('renumbers the WHOLE section over the new arrangement (not just the moved row)', () => {
    const result = plan('b', 'sec1', 2);
    expect(result?.crossSection).toBe(false);
    expect(result?.updates).toEqual([
      {id: 'a', sort_order: 1},
      {id: 'c', sort_order: 2},
      {id: 'b', sort_order: 3},
    ]);
    expect(result?.nextOrder.get('sec1')).toEqual(['a', 'c', 'b']);
    expect(result?.nextOrder.get('sec2')).toEqual(['d']);
  });

  it('carries the inverse slot: from/to make up-then-down return', () => {
    const down = plan('b', 'sec1', 2);
    expect(down?.fromSectionId).toBe('sec1');
    expect(down?.fromIndex).toBe(1);
    expect(down?.toIndex).toBe(2);
    // The inverse move (T5): re-dispatch to the captured from slot.
    const back = planFieldMove({
      order: down!.nextOrder,
      fieldId: 'b',
      toSectionId: down!.fromSectionId,
      toIndex: down!.fromIndex,
      appendToEnd: false,
      pendingIds: none,
    });
    expect(back?.nextOrder.get('sec1')).toEqual(['a', 'b', 'c']);
  });

  it('a same-position move is a no-op (null) — rapid repeats coalesce', () => {
    expect(plan('b', 'sec1', 1)).toBeNull();
  });

  it('clamps toIndex into the destination range', () => {
    const result = plan('a', 'sec1', 99);
    expect(result?.toIndex).toBe(2);
    expect(result?.nextOrder.get('sec1')).toEqual(['b', 'c', 'a']);
  });
});

describe('planFieldMove — cross-section move', () => {
  it('the moved row rides moveField (excluded from the batch); BOTH sections renumber', () => {
    const result = plan('c', 'sec2', 0);
    expect(result?.crossSection).toBe(true);
    expect(result?.movedSortOrder).toBe(1);
    expect(result?.updates).toEqual([
      {id: 'a', sort_order: 1},
      {id: 'b', sort_order: 2},
      {id: 'd', sort_order: 2},
    ]);
    expect(result?.nextOrder.get('sec1')).toEqual(['a', 'b']);
    expect(result?.nextOrder.get('sec2')).toEqual(['c', 'd']);
    expect(result?.destCount).toBe(2);
  });

  it('a repeat of an in-flight cross-section move coalesces to nothing (no duplicate moveField)', () => {
    const first = plan('c', 'sec2', 0);
    // The stale grid still shows `c` in sec1, so the repeated chord asks
    // for the same slot — but the working order already has it there.
    const repeat = planFieldMove({
      order: first!.nextOrder,
      fieldId: 'c',
      toSectionId: 'sec2',
      toIndex: 0,
      appendToEnd: false,
      pendingIds: none,
    });
    expect(repeat).toBeNull();
  });

  it('a collapsed destination appends to the section true END', () => {
    // The cell model saw zero visible field rows (toIndex 0); the plan
    // must land at the real end (panel decision 4).
    const result = planFieldMove({
      order: new Map([
        ['sec1', ['a', 'b']],
        ['sec2', ['x', 'y', 'z']],
      ]),
      fieldId: 'a',
      toSectionId: 'sec2',
      toIndex: 0,
      appendToEnd: true,
      pendingIds: none,
    });
    expect(result?.toIndex).toBe(3);
    expect(result?.movedSortOrder).toBe(4);
    expect(result?.nextOrder.get('sec2')).toEqual(['x', 'y', 'z', 'a']);
  });
});

describe('planFieldMove — pending rows and unknowns', () => {
  it('pending rows hold their visible slot but never enter the write batch', () => {
    const result = planFieldMove({
      order: new Map([['sec1', ['a', 'pending-1', 'b']]]),
      fieldId: 'b',
      toSectionId: 'sec1',
      toIndex: 0,
      appendToEnd: false,
      pendingIds: new Set(['pending-1']),
    });
    // Positions are assigned over the FULL visible arrangement (pending
    // row included) but the pending row itself gets no write — it has
    // no server id yet; the insert queue owns its eventual sort_order.
    expect(result?.updates).toEqual([
      {id: 'b', sort_order: 1},
      {id: 'a', sort_order: 2},
    ]);
    expect(result?.nextOrder.get('sec1')).toEqual(['b', 'a', 'pending-1']);
  });

  it('an unknown field or destination section plans nothing', () => {
    expect(plan('ghost', 'sec1', 0)).toBeNull();
    expect(plan('a', 'nowhere', 0)).toBeNull();
  });
});

describe('applySectionOrder — the optimistic order overlay (panel decision 7)', () => {
  const overlayTree = () =>
    buildTemplateTree(
      [
        {id: 's1', name: 's', label: 'S', sort_order: 1},
        {id: 'g1', name: 'g', label: 'G', role: 'model_container', sort_order: 2},
        {id: 'c1', name: 'c', label: 'C', parent_entity_type_id: 'g1', sort_order: 1},
      ],
      [
        {id: 'f1', entity_type_id: 's1', name: 'k1', label: 'A', field_type: 'text', sort_order: 1},
        {id: 'f2', entity_type_id: 's1', name: 'k2', label: 'B', field_type: 'text', sort_order: 2},
        {id: 'f3', entity_type_id: 'c1', name: 'k3', label: 'C', field_type: 'text', sort_order: 1},
      ],
    );

  const fieldIds = (tree: ReturnType<typeof overlayTree>, sectionId: string) =>
    findSection(tree, sectionId)?.fields.map((f) => f.id);

  it('re-slots fields within a section to the planned order', () => {
    const next = applySectionOrder(
      overlayTree(),
      new Map([
        ['s1', ['f2', 'f1']],
        ['g1', []],
        ['c1', ['f3']],
      ]),
    );
    expect(fieldIds(next, 's1')).toEqual(['f2', 'f1']);
    expect(fieldIds(next, 'c1')).toEqual(['f3']);
  });

  it('re-homes a field across sections — entityTypeId and both counts follow', () => {
    const next = applySectionOrder(
      overlayTree(),
      new Map([
        ['s1', ['f1']],
        ['g1', []],
        ['c1', ['f3', 'f2']],
      ]),
    );
    expect(fieldIds(next, 's1')).toEqual(['f1']);
    expect(fieldIds(next, 'c1')).toEqual(['f3', 'f2']);
    const child = findSection(next, 'c1');
    expect(child?.fields[1].entityTypeId).toBe('c1');
    expect(findSection(next, 's1')?.fieldCount).toBe(1);
    expect(child?.fieldCount).toBe(2);
    // The group's rollup counts its re-homed descendant.
    expect(findSection(next, 'g1')?.totalFieldCount).toBe(2);
  });

  it('drops order ids the tree no longer serves (deleted mid-flight)', () => {
    const next = applySectionOrder(
      overlayTree(),
      new Map([
        ['s1', ['f1', 'gone', 'f2']],
        ['g1', []],
        ['c1', ['f3']],
      ]),
    );
    expect(fieldIds(next, 's1')).toEqual(['f1', 'f2']);
  });

  it('keeps tree fields the order does not know, after the ordered rows', () => {
    // e.g. a pending insert confirmed mid-flight: the refetch serves it
    // before the working order ever saw it.
    const next = applySectionOrder(
      overlayTree(),
      new Map([
        ['s1', ['f2']],
        ['g1', []],
        ['c1', ['f3']],
      ]),
    );
    expect(fieldIds(next, 's1')).toEqual(['f2', 'f1']);
  });

  it('a section absent from the order never duplicates a field another section claims', () => {
    const next = applySectionOrder(
      overlayTree(),
      // c1 has no entry, yet s1's entry claims its field.
      new Map([['s1', ['f1', 'f2', 'f3']]]),
    );
    expect(fieldIds(next, 's1')).toEqual(['f1', 'f2', 'f3']);
    expect(fieldIds(next, 'c1')).toEqual([]);
  });
});
