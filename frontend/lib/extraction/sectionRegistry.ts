import { computeRequiredFieldProgress } from '@/lib/extraction/progress';
import type {
  ExtractionEntityTypeWithFields,
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
  level: 0 | 1;
}

export interface BuildSectionRegistryArgs {
  studyLevelSections: ExtractionEntityTypeWithFields[];
  modelParentEntityType?: ExtractionEntityTypeWithFields;
  modelChildSections: ExtractionEntityTypeWithFields[];
  instances: ExtractionInstance[];
  values: Record<string, ExtractionValue>;
  activeModelId: string | null;
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
  level: 0 | 1,
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
  const progress = computeRequiredFieldProgress(
    values,
    [{ id: et.id, fields: et.fields, is_required: et.is_required }],
    new Map([[et.id, ids]]),
  );
  return {
    id: et.id,
    label: et.label,
    requiredTotal: progress.totalFields,
    requiredFilled: progress.completedFields,
    state: toState(progress.completedFields, progress.totalFields),
    level,
  };
}

export function buildSectionRegistry(args: BuildSectionRegistryArgs): SectionNavItem[] {
  // Group instances by entity type once (O(N)) so each section is an O(bucket)
  // lookup instead of an O(N) rescan per section.
  const byType = groupByEntityType(args.instances);
  const items: SectionNavItem[] = [];
  for (const et of args.studyLevelSections) {
    items.push(sectionItem(et, 0, args.values, byType));
  }
  if (args.modelParentEntityType) {
    items.push(sectionItem(args.modelParentEntityType, 0, args.values, byType));
    if (args.activeModelId !== null) {
      for (const child of args.modelChildSections) {
        items.push(sectionItem(child, 1, args.values, byType, args.activeModelId));
      }
    }
  }
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
