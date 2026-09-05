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

import {useMemo, useState} from 'react';

import type {Entry} from '@/components/extraction/entries/types';
import {DEFAULT_ENTRY_NOUN} from '@/lib/extraction/entryKey';
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
}

export interface UseEntryGroupReturn {
  entries: ExtractionInstance[];
  /** The entries as the selector renders them, with subtree progress. */
  entryCards: Entry[];
  activeEntryId: string | null;
  setActiveEntryId: (id: string) => void;
  noun: string;
}

/** `localStorage` slot for one (article, group, parent) triple. */
function storageKey(articleId: string, groupId: string, parentInstanceId: string | null): string {
  return `active-entry-${articleId}-${groupId}-${parentInstanceId ?? 'root'}`;
}

function readStored(key: string): string | null {
  // Guarded: a private window or blocked site data throws on ACCESS, and this
  // hook runs once per rendered group, so an unguarded read throws per node.
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* a remembered selection is a convenience, never a correctness input */
  }
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
  const [explicitId, setExplicitId] = useState<string | null>(null);

  const entries = useMemo(
    () =>
      instances
        .filter(
          (i) =>
            i.entity_type_id === group.id &&
            (i.parent_instance_id ?? null) === parentInstanceId,
        )
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [instances, group.id, parentInstanceId],
  );

  const key = storageKey(articleId, group.id, parentInstanceId);

  // The existence check guards the RESTORED id ONLY. Applying it to an
  // explicit selection would snap a just-created entry back to the first one
  // until the run-view refetch lands.
  const activeEntryId =
    explicitId ??
    (() => {
      const stored = readStored(key);
      if (stored && entries.some((e) => e.id === stored)) return stored;
      return entries[0]?.id ?? null;
    })();

  const setActiveEntryId = (id: string) => {
    setExplicitId(id);
    writeStored(key, id);
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
