/**
 * Snapshot + replay for a deleted section subtree (B-9d part 2).
 *
 * Deleting a section CASCADES in the database:
 * `extraction_fields_entity_type_id_fkey` and
 * `extraction_entity_types_parent_entity_type_id_fkey` are both ON DELETE
 * CASCADE, so removing a repeating group takes its child sections and every
 * field beneath them with it. Nothing is soft-deleted and nothing is
 * tombstoned, so Undo cannot ask the server for the rows back — it has to
 * replay them from a snapshot captured BEFORE the delete.
 *
 * Everything comes back with NEW ids. That is safe for the same reason the
 * field case is: a section holding extraction instances cannot be deleted
 * at all (`extraction_instances_entity_type_id_fkey` is ON DELETE RESTRICT),
 * so a subtree that WAS deletable provably had no run data pointing into it.
 *
 * Pure planning, injected IO — the ordering rules below are the whole risk,
 * and they are only checkable if they are testable without a network.
 */
import type {TemplateEntityTypeWithFields} from '@/hooks/extraction/useTemplateEntityTypes';
import type {CreateSectionParams} from '@/services/templateService';
import type {ExtractionFieldInsert} from '@/types/extraction';

type SectionRole = CreateSectionParams['role'];

/** One section of the captured subtree, in creation order (parents first). */
interface CapturedSection {
  id: string;
  /** The captured parent id — DEAD after the cascade; replay rewrites it. */
  parentId: string | null;
  name: string;
  label: string;
  description: string | null;
  role: SectionRole;
  cardinality: 'one' | 'many';
  isRequired: boolean;
  entryLabel: string | null;
  fields: CapturedField[];
}

interface CapturedField {
  name: string;
  label: string;
  description: string | null;
  fieldType: ExtractionFieldInsert['field_type'];
  isRequired: boolean;
  allowedValues: string[] | null;
  unit: string | null;
  allowedUnits: string[] | null;
  /** ✨ AI instruction — present on the raw row; dropping it here made the
   * first B-9d ship a silently lossy undo. */
  aiInstruction: string | null;
  allowOther: boolean;
  otherLabel: string | null;
  otherPlaceholder: string | null;
  /** ADR-0016 per-field dispositions. `allowsNoInformation` defaults TRUE
   * (migration 0062): a pre-0062 row carries no key and the marker WAS
   * available, so capturing it as false would make Undo lossy in the one
   * direction nobody would notice. */
  allowsNotApplicable: boolean;
  allowsNotEvaluated: boolean;
  allowsNoInformation: boolean;
  validationSchema: Record<string, unknown>;
  sortOrder: number;
}

export interface SectionSnapshot {
  rootId: string;
  /** Breadth-first: a section always appears after its parent. */
  sections: CapturedSection[];
}

/**
 * Everything the cascade is about to destroy, or `null` if the id is
 * unknown.
 *
 * `null` rather than an empty snapshot on purpose: an empty one would
 * "restore" nothing and still report success.
 */
export function captureSection(
  entityTypes: TemplateEntityTypeWithFields[],
  sectionId: string,
): SectionSnapshot | null {
  const root = entityTypes.find((et) => et.id === sectionId);
  if (!root) return null;

  const sections: CapturedSection[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sections.push(capture(current));
    // Breadth-first, so a parent is always created before its children.
    queue.push(...entityTypes.filter((et) => et.parent_entity_type_id === current.id));
  }
  return {rootId: sectionId, sections};
}

function capture(entityType: TemplateEntityTypeWithFields): CapturedSection {
  return {
    id: entityType.id,
    parentId: entityType.parent_entity_type_id ?? null,
    name: entityType.name,
    label: entityType.label ?? entityType.name,
    description: entityType.description ?? null,
    // The read widens these to string; the create payloads want the
    // closed unions the server validates against anyway.
    role: (entityType.role ?? 'study_section') as SectionRole,
    cardinality: entityType.cardinality === 'many' ? 'many' : 'one',
    isRequired: Boolean(entityType.is_required),
    entryLabel: entityType.entry_label ?? null,
    fields: [...(entityType.fields ?? [])]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((field) => ({
        name: field.name,
        label: field.label ?? field.name,
        description: field.description ?? null,
        fieldType: field.field_type as ExtractionFieldInsert['field_type'],
        isRequired: Boolean(field.is_required),
        allowedValues: field.allowed_values ?? null,
        unit: field.unit ?? null,
        allowedUnits: field.allowed_units ?? null,
        aiInstruction: field.llm_description ?? null,
        allowOther: Boolean(field.allow_other),
        otherLabel: field.other_label ?? null,
        otherPlaceholder: field.other_placeholder ?? null,
        allowsNotApplicable: Boolean(field.allows_not_applicable),
        allowsNotEvaluated: Boolean(field.allows_not_evaluated),
        // Defaults TRUE when absent (migration 0062): dropping it would make
        // Undo silently switch the marker back ON for every restored field.
        allowsNoInformation: field.allows_no_information !== false,
        validationSchema: (field.validation_schema ?? {}) as Record<string, unknown>,
        sortOrder: field.sort_order ?? 0,
      })),
  };
}

interface ReplayDeps {
  createSection: (params: {
    name: string;
    label: string;
    description: string | null;
    cardinality: 'one' | 'many';
    role: SectionRole;
    parentEntityTypeId?: string | null;
    entryLabel?: string | null;
    isRequired: boolean;
  }) => Promise<{ok: true; data: {id: string}} | {ok: false; error: Error}>;
  insertField: (payload: {
    entity_type_id: string;
    name: string;
    label: string;
    description: string | null;
    field_type: ExtractionFieldInsert['field_type'];
    is_required: boolean;
    allowed_values: string[] | null;
    unit: string | null;
    allowed_units: string[] | null;
    llm_description: string | null;
    allow_other: boolean;
    other_label: string | null;
    other_placeholder: string | null;
    allows_not_applicable: boolean;
    allows_not_evaluated: boolean;
    allows_no_information: boolean;
    validation_schema: Record<string, unknown>;
    sort_order: number;
  }) => Promise<{ok: true; data: unknown} | {ok: false; error: Error}>;
}

/**
 * Re-create the captured subtree. Resolves false on the FIRST failure.
 *
 * Sections go back parents-first, and each child's dead `parentId` is
 * rewritten to the id its parent just received — the one step that cannot
 * be skipped, because every captured parent id died with the cascade.
 *
 * A partial replay stops rather than pressing on: reporting success over a
 * half-restored subtree would leave the manager believing their group came
 * back intact.
 */
export async function replaySection(
  snapshot: SectionSnapshot,
  deps: ReplayDeps,
): Promise<boolean> {
  const newIdByOldId = new Map<string, string>();

  for (const section of snapshot.sections) {
    const parentEntityTypeId =
      section.parentId === null ? null : (newIdByOldId.get(section.parentId) ?? null);

    const created = await deps.createSection({
      name: section.name,
      label: section.label,
      description: section.description,
      cardinality: section.cardinality,
      role: section.role,
      parentEntityTypeId,
      entryLabel: section.entryLabel,
      isRequired: section.isRequired,
    });
    if (!created.ok) return false;
    newIdByOldId.set(section.id, created.data.id);

    for (const field of section.fields) {
      const inserted = await deps.insertField({
        entity_type_id: created.data.id,
        name: field.name,
        label: field.label,
        description: field.description,
        field_type: field.fieldType,
        is_required: field.isRequired,
        allowed_values: field.allowedValues,
        unit: field.unit,
        allowed_units: field.allowedUnits,
        llm_description: field.aiInstruction,
        allow_other: field.allowOther,
        other_label: field.otherLabel,
        other_placeholder: field.otherPlaceholder,
        allows_not_applicable: field.allowsNotApplicable,
        allows_not_evaluated: field.allowsNotEvaluated,
        allows_no_information: field.allowsNoInformation,
        validation_schema: field.validationSchema,
        sort_order: field.sortOrder,
      });
      if (!inserted.ok) return false;
    }
  }
  return true;
}
