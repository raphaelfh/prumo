import { entrySlotKey } from '@/lib/extraction/entrySlots';
import { computeRequiredFieldProgress } from '@/lib/extraction/progress';
import type {
  ExtractionEntityTypeWithFields,
  ExtractionField,
  ExtractionInstance,
  ExtractionValue,
} from '@/types/extraction';

export type SectionNavState = 'complete' | 'in_progress' | 'empty';

export interface SectionNavItem {
  id: string;
  label: string;
  requiredTotal: number;
  requiredFilled: number;
  state: SectionNavState;
  /** Nesting depth. Was `0 | 1` while the tree was capped at two levels. */
  level: number;
}

export interface BuildSectionRegistryArgs {
  /** Sections with no parent, in sort order. */
  roots: ExtractionEntityTypeWithFields[];
  /** Every section of the template, so the walk can find children. */
  entityTypes: ExtractionEntityTypeWithFields[];
  instances: ExtractionInstance[];
  values: Record<string, ExtractionValue>;
  /**
   * Which entry is active in each rendered group, keyed by
   * `entrySlotKey(article, group, parent)`. A group's children are described
   * against its ACTIVE entry, so the rail and the global percentage measure
   * what the form is showing — the semantic the two-level version had.
   */
  activeEntries: Record<string, string>;
  articleId: string;
}

function groupByEntityType(
  instances: ExtractionInstance[],
): Map<string, ExtractionInstance[]> {
  const byType = new Map<string, ExtractionInstance[]>();
  for (const inst of instances) {
    const bucket = byType.get(inst.entity_type_id);
    if (bucket) bucket.push(inst);
    else byType.set(inst.entity_type_id, [inst]);
  }
  return byType;
}

function toState(filled: number, total: number): SectionNavState {
  if (total > 0 && filled === total) return 'complete';
  if (filled > 0) return 'in_progress';
  return 'empty';
}

function sectionItem(
  et: ExtractionEntityTypeWithFields,
  level: number,
  values: Record<string, ExtractionValue>,
  byType: Map<string, ExtractionInstance[]>,
  parentInstanceId?: string | null,
): SectionNavItem {
  const bucket = byType.get(et.id) ?? [];
  const ids = new Set<string>();
  for (const inst of bucket) {
    if (parentInstanceId !== undefined && inst.parent_instance_id !== parentInstanceId) continue;
    ids.add(inst.id);
  }
  return navItem({ id: et.id, label: et.label, fields: et.fields, isRequired: et.is_required }, ids, values, level);
}

interface NavSection {
  id: string;
  label: string;
  fields: ExtractionField[];
  isRequired: boolean;
}

/** One rail entry: required-field progress scoped to the section's own instances. */
function navItem(
  section: NavSection,
  instanceIds: Set<string>,
  values: Record<string, unknown>,
  level: number,
): SectionNavItem {
  const progress = computeRequiredFieldProgress(
    values,
    [{ id: section.id, fields: section.fields, is_required: section.isRequired }],
    new Map([[section.id, instanceIds]]),
  );
  return {
    id: section.id,
    label: section.label,
    requiredTotal: progress.totalFields,
    requiredFilled: progress.completedFields,
    state: toState(progress.completedFields, progress.totalFields),
    level,
  };
}

export interface FlatSection extends NavSection {
  /** The one instance this section's values belong to. */
  instanceId: string;
}

/**
 * The rail for a flat form — one level, one instance per section (the QA
 * domains). Built from the same `navItem` as the extraction tree.
 */
export function buildFlatSectionRegistry(
  sections: FlatSection[],
  values: Record<string, unknown>,
): SectionNavItem[] {
  return sections.map((s) => navItem(s, new Set([s.instanceId]), values, 0));
}

/** The entry a group is currently showing in one parent slot, if any. */
function activeEntryOf(
  args: BuildSectionRegistryArgs,
  byType: Map<string, ExtractionInstance[]>,
  groupId: string,
  parentInstanceId: string | null,
): string | null {
  const stored = args.activeEntries[entrySlotKey(args.articleId, groupId, parentInstanceId)];
  const entries = (byType.get(groupId) ?? []).filter(
    (i) => (i.parent_instance_id ?? null) === parentInstanceId,
  );
  // Mirror the form: a stored id that no longer exists falls back to the
  // first entry, so the rail never describes a subtree nothing is showing.
  if (stored && entries.some((e) => e.id === stored)) return stored;
  return entries[0]?.id ?? null;
}

export function buildSectionRegistry(args: BuildSectionRegistryArgs): SectionNavItem[] {
  // Group instances by entity type once (O(N)) so each section is an O(bucket)
  // lookup instead of an O(N) rescan per section.
  const byType = groupByEntityType(args.instances);
  const childrenOf = new Map<string, ExtractionEntityTypeWithFields[]>();
  for (const et of args.entityTypes) {
    if (!et.parent_entity_type_id) continue;
    const bucket = childrenOf.get(et.parent_entity_type_id);
    if (bucket) bucket.push(et);
    else childrenOf.set(et.parent_entity_type_id, [et]);
  }

  const items: SectionNavItem[] = [];
  const seen = new Set<string>();

  const walk = (
    et: ExtractionEntityTypeWithFields,
    level: number,
    parentInstanceId: string | null,
  ): void => {
    // The parent link is data; a cycle would otherwise hang the nav rail.
    if (seen.has(et.id)) return;
    seen.add(et.id);

    items.push(
      sectionItem(
        et,
        level,
        args.values,
        byType,
        parentInstanceId === null && !et.parent_entity_type_id ? undefined : parentInstanceId,
      ),
    );

    const children = childrenOf.get(et.id) ?? [];
    if (children.length === 0) return;
    // Only a repeating section scopes its children to one entry; a singleton
    // has exactly one instance in this slot.
    const scope =
      et.cardinality === 'many'
        ? activeEntryOf(args, byType, et.id, parentInstanceId)
        : ((byType.get(et.id) ?? []).find(
            (i) => (i.parent_instance_id ?? null) === parentInstanceId,
          )?.id ?? null);
    if (scope === null) return;
    for (const child of children) walk(child, level + 1, scope);
  };

  for (const root of args.roots) walk(root, 0, null);
  return items;
}

export interface GlobalProgress {
  requiredFilled: number;
  requiredTotal: number;
  requiredLeft: number;
  percentage: number;
}

export function globalProgressFromRegistry(items: SectionNavItem[]): GlobalProgress {
  let requiredTotal = 0;
  let requiredFilled = 0;
  for (const i of items) {
    requiredTotal += i.requiredTotal;
    requiredFilled += i.requiredFilled;
  }
  const requiredLeft = Math.max(0, requiredTotal - requiredFilled);
  const percentage = requiredTotal > 0 ? Math.round((requiredFilled / requiredTotal) * 100) : 0;
  return { requiredFilled, requiredTotal, requiredLeft, percentage };
}
