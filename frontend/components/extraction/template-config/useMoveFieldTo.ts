/**
 * The panel's serialized dispatcher for structural field moves (B-6 T3).
 *
 * ONE chokepoint for every move/reorder write — today's ⌘⇧ chord, T4's
 * Section combobox, and T5's Undo (which re-enters through `moveFieldTo`
 * with the returned record's `from` slot, captured AT DISPATCH TIME).
 *
 * Serialization (panel decision 3): writes chain behind an in-flight
 * promise so two renumbering batches never interleave, and every
 * dispatch plans from the LATEST local order — a working per-section
 * order accumulated across the burst, so rapid keyboard repeats
 * coalesce instead of re-planning from the stale tree. The working
 * order resets when the chain drains (or a write fails, after which it
 * would lie); the next burst re-derives from the refetched tree. A
 * failure also refetches (reorderFields is N independent writes — a
 * partial batch may have landed) and poisons the rest of the burst:
 * executes already queued behind it skip, since their plans were
 * premised on the failed write; a fresh dispatch starts clean.
 *
 * `settled` resolves only after the writes AND an awaited structure
 * refetch — the grid's focus nudge and the next burst both need the
 * refetched tree on screen. Success feedback is T5's Undo toast; the
 * only other feedback is the polite live-region announcement, made on
 * settle (the moved row may re-render far away or inside a collapsed
 * section).
 *
 * `displayTree` is the optimistic order overlay (panel decision 7): the
 * working order mirrored into state and applied over the tree, so the
 * grid renders the PLANNED order the moment a move dispatches — a
 * dropped or chorded row never snaps back while the write flies. It
 * clears with the working order: on drain (the awaited refetch is on
 * screen — same order, no flicker) and on failure (the overlay must
 * never lie about a write that did not land).
 */
import {useMemo, useRef, useState} from 'react';

import {useMoveTemplateField} from '@/hooks/extraction/useMoveTemplateField';
import {useReorderTemplateFields} from '@/hooks/extraction/useReorderTemplateFields';
import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {t} from '@/lib/copy';

import {
  applySectionOrder,
  deriveSectionOrder,
  planFieldMove,
  type SectionFieldOrder,
} from './fieldMove';
import {findSection, type GridField, type GridSection} from './templateTree';

export interface FieldMoveRecord {
  /** Where the field sat at dispatch time — T5's inverse move target. */
  from: {sectionId: string; index: number};
  to: {sectionId: string; index: number};
  /** Resolves once the serialized writes and the structure refetch have
   * landed; `true` only when every write succeeded. Never rejects. */
  settled: Promise<boolean>;
}

export interface MoveFieldOptions {
  /** T5 undo re-entry: land EXACTLY at `toIndex` — the collapsed-
   * destination append is a live-gesture affordance (the cell model only
   * saw zero visible rows), not an undo semantic; the captured index
   * must be restored as-is. */
  exactIndex?: boolean;
}

interface MoveChainState {
  chain: Promise<unknown>;
  order: SectionFieldOrder | null;
  inflight: number;
  /** Burst poison marker: bumped on a failed write so executes queued
   * BEHIND the failure (planned on top of it) skip instead of writing. */
  epoch: number;
}

export function useMoveFieldTo(args: {
  projectId: string;
  templateId: string;
  tree: GridSection[];
  collapsed: ReadonlySet<string>;
  pendingRowIds: ReadonlySet<string>;
}) {
  const {projectId, templateId, tree, collapsed, pendingRowIds} = args;
  // invalidateOnSuccess: false — the dispatcher owns invalidation (ONE
  // awaited refetch per settled move, not one per underlying write).
  const moveMutation = useMoveTemplateField(projectId, templateId, {
    invalidateOnSuccess: false,
  });
  const reorderMutation = useReorderTemplateFields(projectId, templateId, {
    invalidateOnSuccess: false,
  });
  const {invalidateStructure} = useTemplateConfigCaches(projectId, templateId);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  // The working order mirrored into state — the render-side half of the
  // overlay (the ref stays authoritative for planning).
  const [localOrder, setLocalOrder] = useState<SectionFieldOrder | null>(null);
  const stateRef = useRef<MoveChainState>({
    chain: Promise.resolve(),
    order: null,
    inflight: 0,
    epoch: 0,
  });

  const moveFieldTo = (
    field: GridField,
    toSectionId: string,
    toIndex: number,
    opts?: MoveFieldOptions,
  ): FieldMoveRecord | null => {
    // The grid already gates the chord on pending rows; this guard
    // covers every other entry point (T4 combobox, T5 undo).
    if (pendingRowIds.has(field.id)) return null;
    const state = stateRef.current;
    const plan = planFieldMove({
      order: state.order ?? deriveSectionOrder(tree),
      fieldId: field.id,
      toSectionId,
      toIndex,
      appendToEnd: !opts?.exactIndex && collapsed.has(toSectionId),
      pendingIds: pendingRowIds,
    });
    if (!plan) return null;
    state.order = plan.nextOrder;
    setLocalOrder(plan.nextOrder);
    state.inflight += 1;
    // Captured at dispatch time: a failed write bumps the epoch, so this
    // execute knows whether an EARLIER write in the burst failed under it.
    const epoch = state.epoch;
    const destLabel = findSection(tree, toSectionId)?.label ?? '';

    const execute = async (): Promise<boolean> => {
      // An earlier write in the burst failed — this plan was premised on
      // it; skip (the failure already refetched, and a fresh dispatch
      // will re-derive from the refetched tree).
      if (state.epoch !== epoch) return false;
      // Failure: refetch fire-and-forget — reorderFields is N independent
      // writes, so a partial batch may have landed and the screen must
      // mirror whatever the DB now holds (the awaited success-path
      // invalidation below is never reached on this path).
      const fail = (): false => {
        state.epoch += 1;
        void invalidateStructure();
        return false;
      };
      if (plan.crossSection) {
        const moved = await moveMutation
          .mutateAsync({
            fieldId: field.id,
            entityTypeId: toSectionId,
            sortOrder: plan.movedSortOrder,
          })
          .then(
            () => true,
            () => false, // the hook already toasted the failure
          );
        if (!moved) return fail();
      }
      if (plan.updates.length > 0) {
        const renumbered = await reorderMutation
          .mutateAsync({updates: plan.updates})
          .then(
            () => true,
            () => false,
          );
        if (!renumbered) return fail();
      }
      // The T1 hooks mount with invalidateOnSuccess: false — the
      // dispatcher owns invalidation, and this awaited one makes
      // `settled` mean "the refetched tree landed".
      await invalidateStructure();
      return true;
    };

    const settled = state.chain.then(execute, execute).then(
      (ok) => ok,
      () => false,
    );
    state.chain = settled.then((ok) => {
      state.inflight -= 1;
      // Drain — or a failed write, after which the working order lies:
      // the next dispatch re-derives from the (refetched) tree, and the
      // display overlay retires with it.
      if (!ok || state.inflight === 0) {
        state.order = null;
        setLocalOrder(null);
      }
      if (ok) {
        setAnnouncement(
          t('templateConfig', 'moveAnnouncement')
            .replace('{{field}}', field.label)
            .replace('{{section}}', destLabel)
            .replace('{{position}}', String(plan.toIndex + 1))
            .replace('{{count}}', String(plan.destCount)),
        );
      }
    });
    return {
      from: {sectionId: plan.fromSectionId, index: plan.fromIndex},
      to: {sectionId: plan.toSectionId, index: plan.toIndex},
      settled,
    };
  };

  const displayTree = useMemo(
    () => (localOrder ? applySectionOrder(tree, localOrder) : tree),
    [tree, localOrder],
  );

  return {moveFieldTo, announcement, displayTree};
}
