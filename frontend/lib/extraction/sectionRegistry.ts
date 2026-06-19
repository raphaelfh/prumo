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

function instanceIdsFor(
  entityTypeId: string,
  instances: ExtractionInstance[],
  parentInstanceId?: string | null,
): Map<string, Set<string>> {
  const ids = new Set<string>();
  for (const inst of instances) {
    if (inst.entity_type_id !== entityTypeId) continue;
    if (parentInstanceId !== undefined && inst.parent_instance_id !== parentInstanceId) continue;
    ids.add(inst.id);
  }
  return new Map([[entityTypeId, ids]]);
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
  instances: ExtractionInstance[],
  parentInstanceId?: string | null,
): SectionNavItem {
  const idMap = instanceIdsFor(et.id, instances, parentInstanceId);
  const progress = computeRequiredFieldProgress(
    values,
    [{ id: et.id, fields: et.fields, is_required: et.is_required }],
    idMap,
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
  const items: SectionNavItem[] = [];
  for (const et of args.studyLevelSections) {
    items.push(sectionItem(et, 0, args.values, args.instances));
  }
  if (args.modelParentEntityType) {
    items.push(sectionItem(args.modelParentEntityType, 0, args.values, args.instances));
    if (args.activeModelId !== null) {
      for (const child of args.modelChildSections) {
        items.push(sectionItem(child, 1, args.values, args.instances, args.activeModelId));
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
  const requiredTotal = items.reduce((n, i) => n + i.requiredTotal, 0);
  const requiredFilled = items.reduce((n, i) => n + i.requiredFilled, 0);
  const requiredLeft = Math.max(0, requiredTotal - requiredFilled);
  const percentage = requiredTotal > 0 ? Math.round((requiredFilled / requiredTotal) * 100) : 0;
  return { requiredFilled, requiredTotal, requiredLeft, percentage };
}
