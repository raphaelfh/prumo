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
 * would lie); the next burst re-derives from the refetched tree.
 *
 * `settled` resolves only after the writes AND an awaited structure
 * refetch — the grid's focus nudge and the next burst both need the
 * refetched tree on screen. Success feedback is T5's Undo toast; the
 * only immediate feedback here is the polite live-region announcement
 * (the moved row may re-render far away or inside a collapsed section).
 */
import {useRef, useState} from 'react';

import {useMoveTemplateField} from '@/hooks/extraction/useMoveTemplateField';
import {useReorderTemplateFields} from '@/hooks/extraction/useReorderTemplateFields';
import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {t} from '@/lib/copy';

import {deriveSectionOrder, planFieldMove, type SectionFieldOrder} from './fieldMove';
import {findSection, type GridField, type GridSection} from './templateTree';

export interface FieldMoveRecord {
  /** Where the field sat at dispatch time — T5's inverse move target. */
  from: {sectionId: string; index: number};
  to: {sectionId: string; index: number};
  /** Resolves once the serialized writes and the structure refetch have
   * landed; `true` only when every write succeeded. Never rejects. */
  settled: Promise<boolean>;
}

interface MoveChainState {
  chain: Promise<unknown>;
  order: SectionFieldOrder | null;
  inflight: number;
}

export function useMoveFieldTo(args: {
  projectId: string;
  templateId: string;
  tree: GridSection[];
  collapsed: ReadonlySet<string>;
  pendingRowIds: ReadonlySet<string>;
}) {
  const {projectId, templateId, tree, collapsed, pendingRowIds} = args;
  const moveMutation = useMoveTemplateField(projectId, templateId);
  const reorderMutation = useReorderTemplateFields(projectId, templateId);
  const {invalidateStructure} = useTemplateConfigCaches(projectId, templateId);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const stateRef = useRef<MoveChainState>({
    chain: Promise.resolve(),
    order: null,
    inflight: 0,
  });

  const moveFieldTo = (
    field: GridField,
    toSectionId: string,
    toIndex: number,
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
      appendToEnd: collapsed.has(toSectionId),
      pendingIds: pendingRowIds,
    });
    if (!plan) return null;
    state.order = plan.nextOrder;
    state.inflight += 1;
    const destLabel = findSection(tree, toSectionId)?.label ?? '';

    const execute = async (): Promise<boolean> => {
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
        if (!moved) return false;
      }
      if (plan.updates.length > 0) {
        const renumbered = await reorderMutation
          .mutateAsync({updates: plan.updates})
          .then(
            () => true,
            () => false,
          );
        if (!renumbered) return false;
      }
      // The hooks' own onSuccess invalidation is fire-and-forget; this
      // awaited one makes `settled` mean "the refetched tree landed".
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
      // the next dispatch re-derives from the (refetched) tree.
      if (!ok || state.inflight === 0) state.order = null;
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

  return {moveFieldTo, announcement};
}
