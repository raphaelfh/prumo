/**
 * Pure adapter functions that map a ``RunViewResponse`` (the typed API shape
 * returned by GET /api/v1/runs/:id/view) onto the form's internal types
 * (``ExtractionEntityTypeWithFields[]`` and ``ExtractionInstance[]``).
 *
 * No hooks, no side-effects, no component imports — safe to import anywhere.
 */

import type {
  ExtractionCardinality,
  ExtractionEntityRole,
  ExtractionEntityTypeWithFields,
  ExtractionField,
  ExtractionFieldType,
  ExtractionInstance,
} from '@/types/extraction';

import type {
  RunViewFieldResponse,
  RunViewResponse,
} from '@/hooks/runs/types';

// ---------------------------------------------------------------------------
// Internal helper — field mapper (curried on entity_type_id)
// ---------------------------------------------------------------------------

function fieldFromRunView(
  entityTypeId: string,
  createdAt: string,
  f: RunViewFieldResponse,
): ExtractionField {
  return {
    id: f.id,
    entity_type_id: entityTypeId,
    name: f.name,
    label: f.label,
    description: f.description,
    field_type: f.field_type as ExtractionFieldType,
    is_required: f.is_required,
    validation_schema: f.validation_schema,
    allowed_values: f.allowed_values as string[] | null,
    unit: f.unit,
    allowed_units: f.allowed_units as string[] | null,
    llm_description: f.llm_description,
    sort_order: f.sort_order,
    created_at: createdAt,
    allow_other: f.allow_other,
    other_label: f.other_label,
    other_placeholder: f.other_placeholder,
  };
}

// ---------------------------------------------------------------------------
// entityTypesFromRunView
// ---------------------------------------------------------------------------

/**
 * Map ``view.entity_types`` (``RunViewEntityType[]``) onto the form's
 * ``ExtractionEntityTypeWithFields[]``.
 *
 * Two fields are injected because ``RunViewEntityType`` omits them:
 * - ``template_id``: sourced from ``view.run.template_id``
 * - ``created_at``: placeholder from ``view.run.created_at`` (the form
 *   never reads this field; it is required by the interface)
 */
export function entityTypesFromRunView(
  view: RunViewResponse,
): ExtractionEntityTypeWithFields[] {
  const {template_id, created_at} = view.run;

  return view.entity_types.map(et => ({
    id: et.id,
    template_id,
    name: et.name,
    label: et.label,
    description: et.description,
    parent_entity_type_id: et.parent_entity_type_id,
    cardinality: et.cardinality as ExtractionCardinality,
    role: et.role as ExtractionEntityRole,
    sort_order: et.sort_order,
    is_required: et.is_required,
    created_at,
    fields: et.fields.map(f => fieldFromRunView(et.id, created_at, f)),
  }));
}

// ---------------------------------------------------------------------------
// instancesFromRunView
// ---------------------------------------------------------------------------

/**
 * Map ``view.instances`` (``RunViewInstanceResponse[]``) onto
 * ``ExtractionInstance[]``.
 *
 * - ``article_id``: ``RunViewInstanceResponse.article_id`` is
 *   ``string | null``; falls back to ``view.run.article_id`` (always a
 *   ``string``) to satisfy ``ExtractionInstance.article_id: string``.
 * - ``label``: guarded with ``?? ''`` — the interface models it as a
 *   required string.
 * - ``status``: cast to the union literal type; the server is the source
 *   of truth.
 *
 * Returns ``[]`` when ``view.instances`` is undefined or empty.
 */
export function instancesFromRunView(view: RunViewResponse): ExtractionInstance[] {
  if (!view.instances?.length) {
    return [];
  }

  return view.instances.map(inst => ({
    id: inst.id,
    project_id: inst.project_id,
    article_id: inst.article_id ?? view.run.article_id,
    template_id: inst.template_id,
    entity_type_id: inst.entity_type_id,
    parent_instance_id: inst.parent_instance_id,
    label: inst.label ?? '',
    sort_order: inst.sort_order,
    status: inst.status as ExtractionInstance['status'],
    metadata: inst.metadata,
    created_by: inst.created_by,
    created_at: inst.created_at,
    updated_at: inst.updated_at,
  }));
}
