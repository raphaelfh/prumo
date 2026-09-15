/**
 * Per-group state for one rendered `EntrySection`.
 *
 * One hook instance per (group, parent entry): the same nested group renders
 * once under each parent entry, and each needs its own selection. The old
 * `useModelManagement` never had to handle that — a template had at most one
 * model container, so one instance sufficed.
 *
 * Entries are DERIVED from the run view the page already loaded; this hook
 * issues no query. That is what retires `useModelManagement`'s load-generation
 * guard (the "Encontradas 1 → 0 → 1" flapping of 2026-07-05): with no load
 * there is no stale resolution to drop, and no optimistic write to supersede.
 * Per-entry progress comes from the same canonical metric the article list and
 * the dashboard use, rather than the `calculate_model_progress` RPC — one
 * fewer `supabase.rpc` on the client and one fewer async gap to guard.
 *
 * @hook
 */

import {useMemo} from 'react';

import type {Entry} from '@/components/extraction/entries/types';
import {DEFAULT_ENTRY_NOUN} from '@/lib/extraction/entryKey';
import {entrySlotKey, resolveEntryGroup, writeStoredEntry} from '@/lib/extraction/entrySlots';
import {
  type ProgressEntityProjection,
  computeRequiredFieldProgress,
} from '@/lib/extraction/progress';
import type {
  ExtractionEntityTypeWithFields,
  ExtractionInstance,
  ExtractionValue,
} from '@/types/extraction';

export interface UseEntryGroupArgs {
  articleId: string;
  group: ExtractionEntityTypeWithFields;
  /** The enclosing entry, or null for a root group. */
  parentInstanceId: string | null;
  /** Every instance of the article, from the run view. */
  instances: ExtractionInstance[];
  values: Record<string, ExtractionValue>;
  entityTypes: ExtractionEntityTypeWithFields[];
  /**
   * Which entry is active, per `(group, parent)` slot. Held ABOVE the hook
   * so the nav rail can scope a nested section's progress to the entry the
   * form is actually showing — the registry cannot see state that lives
   * inside each rendered section.
   */
  activeEntries: Record<string, string>;
  setActiveEntry: (slot: string, entryId: string) => void;
}

export interface UseEntryGroupReturn {
  entries: ExtractionInstance[];
  /** The entries as the selector renders them, with subtree progress. */
  entryCards: Entry[];
  activeEntryId: string | null;
  setActiveEntryId: (id: string) => void;
  noun: string;
}

/** Instance ids in one entry's subtree, including the entry itself. */
function subtreeInstanceIds(
  instances: ExtractionInstance[],
  entryId: string,
): Map<string, Set<string>> {
  const byParent = new Map<string, ExtractionInstance[]>();
  for (const i of instances) {
    if (!i.parent_instance_id) continue;
    const bucket = byParent.get(i.parent_instance_id);
    if (bucket) bucket.push(i);
    else byParent.set(i.parent_instance_id, [i]);
  }
  const out = new Map<string, Set<string>>();
  const add = (i: ExtractionInstance) => {
    let set = out.get(i.entity_type_id);
    if (!set) {
      set = new Set();
      out.set(i.entity_type_id, set);
    }
    set.add(i.id);
  };
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return; // the parent link is client data; do not trust it to be acyclic
    seen.add(id);
    for (const child of byParent.get(id) ?? []) {
      add(child);
      walk(child.id);
    }
  };
  const entry = instances.find((i) => i.id === entryId);
  if (entry) add(entry);
  walk(entryId);
  return out;
}

export function useEntryGroup(args: UseEntryGroupArgs): UseEntryGroupReturn {
  const {articleId, group, parentInstanceId, instances, values, entityTypes} = args;
  const {activeEntries, setActiveEntry} = args;

  const {entries, activeEntryId} = resolveEntryGroup(articleId, group.id, parentInstanceId, instances, activeEntries);
  const key = entrySlotKey(articleId, group.id, parentInstanceId);

  const setActiveEntryId = (id: string) => {
    setActiveEntry(key, id);
    writeStoredEntry(key, id);
  };

  const entryCards = useMemo(
    () =>
      entries.map((entry) => {
        const progress = computeRequiredFieldProgress(
          values,
          entityTypes as unknown as ProgressEntityProjection[],
          subtreeInstanceIds(instances, entry.id),
        );
        return {
          instanceId: entry.id,
          entryName: entry.label ?? '',
          progress: {
            completed: progress.completedFields,
            total: progress.totalFields,
            percentage: progress.completionPercentage,
          },
        } satisfies Entry;
      }),
    [entries, values, entityTypes, instances],
  );

  return {
    entries,
    entryCards,
    activeEntryId,
    setActiveEntryId,
    noun: group.entry_label ?? DEFAULT_ENTRY_NOUN,
  };
}
