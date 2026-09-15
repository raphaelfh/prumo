/**
 * Which entry each rendered entry group is showing.
 *
 * A group renders its children for one entry at a time, and the choice is held
 * above the sections, keyed per slot: the (article, group, parent entry) a
 * rendered group occupies. The form (`useEntryGroup`), the nav rail
 * (`buildSectionRegistry`) and the page (a created entry's selection, the
 * header's suggestion locate) all read or write that map, so the key has one
 * implementation — a second copy could drift and leave the rail describing an
 * entry the form is not showing. It is also the key a selection is remembered
 * under in localStorage, so changing its format forgets every stored choice.
 */
import type {ExtractionEntityTypeWithFields, ExtractionInstance} from '@/types/extraction';

/** The slot one rendered group occupies: (article, group, parent). */
export function entrySlotKey(articleId: string, groupId: string, parentInstanceId: string | null): string {
  return `active-entry-${articleId}-${groupId}-${parentInstanceId ?? 'root'}`;
}

/**
 * The slots to select so one instance is on screen: every entry on its path,
 * the instance itself included when it is one. A group renders its children
 * for its active entry only, so under any other entry the instance and the
 * section holding it do not render at all.
 */
export function entrySlotsShowing(
  articleId: string,
  instanceId: string,
  instances: ExtractionInstance[],
  entityTypes: ExtractionEntityTypeWithFields[],
): [slot: string, entryId: string][] {
  const repeating = new Set(entityTypes.filter((et) => et.cardinality === 'many').map((et) => et.id));
  const slots: [slot: string, entryId: string][] = [];
  const seen = new Set<string>();
  let node = instances.find((i) => i.id === instanceId);
  // The parent link is client data; do not trust it to be acyclic.
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    const parentId = node.parent_instance_id ?? null;
    if (repeating.has(node.entity_type_id)) {
      slots.push([entrySlotKey(articleId, node.entity_type_id, parentId), node.id]);
    }
    node = instances.find((i) => i.id === parentId);
  }
  return slots;
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

export function writeStoredEntry(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* a remembered selection is a convenience, never a correctness input */
  }
}

/** Canonical rendered selection, including remembered selection and entry order. */
export function resolveEntryGroup(articleId: string, groupId: string, parentInstanceId: string | null, instances: ExtractionInstance[], activeEntries: Record<string, string>) {
  const entries = instances.filter(i => i.entity_type_id === groupId && (i.parent_instance_id ?? null) === parentInstanceId)
    .slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const key = entrySlotKey(articleId, groupId, parentInstanceId);
  const stored = readStored(key);
  // Explicit selection may be newly created and awaiting the run-view refetch.
  // Only a restored id is checked for existence before falling back.
  const activeEntryId = activeEntries[key] ?? (stored && entries.some(entry => entry.id === stored) ? stored : entries[0]?.id ?? null);
  return {entries, activeEntryId};
}
