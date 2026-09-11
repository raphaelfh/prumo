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
