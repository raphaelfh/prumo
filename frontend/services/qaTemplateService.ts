// frontend/services/qaTemplateService.ts
/**
 * QA template service — IO for loading global and project-scoped QA
 * templates (PROBAST, QUADAS-2, …) with their entity types and fields,
 * and for opening/resuming QA assessment sessions.
 *
 * Service-layer contract (zero-bailouts spec): exported functions never
 * throw across the boundary; they return ErrorResult<T>. try/catch and
 * throw are free here — module-level functions are not compiled by the
 * React Compiler. Supabase reads are relocated verbatim from hooks (no
 * new reads); the data-path consolidation owns the typed-client swap.
 */
import {apiClient} from '@/integrations/api';
import {supabase} from '@/integrations/supabase/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {ExtractionEntityType, ExtractionField} from '@/types/extraction';
import type {QATemplate, QADomain} from '@/hooks/qa/useQATemplate';
import type {ReviewKind} from '@/lib/comparison/permissions';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type EntityTypeWithFields = ExtractionEntityType & {
  extraction_fields?: ExtractionField[];
};

export interface QATemplateWithDomains {
  template: QATemplate;
  domains: QADomain[];
}

// ---------------------------------------------------------------------------
// useQATemplate: load a global QA template + entity types + fields
// ---------------------------------------------------------------------------

/**
 * Load a global QA template (from extraction_templates_global) together
 * with its entity types and fields tree. Validates that the template kind
 * is "quality_assessment".
 *
 * NOTE: error messages are stored in hook state, not shown as toasts.
 */
export function loadGlobalQATemplate(
  templateId: string,
): Promise<ErrorResult<QATemplateWithDomains>> {
  return toResult(async () => {
    // 1) Template
    const tplRes = await supabase
      .from('extraction_templates_global')
      .select('id, name, description, framework, version, kind')
      .eq('id', templateId)
      .maybeSingle();
    if (tplRes.error) throw tplRes.error;
    if (!tplRes.data) throw new Error('Template not found');
    if (tplRes.data.kind !== 'quality_assessment') {
      throw new Error(
        `Template kind '${tplRes.data.kind}' is not 'quality_assessment'`,
      );
    }

    // 2) Entity types (domains)
    const etRes = await supabase
      .from('extraction_entity_types')
      .select('*')
      .eq('template_id', templateId)
      .order('sort_order', {ascending: true});
    if (etRes.error) throw etRes.error;

    // 3) Fields for each entity type
    const entityIds = (etRes.data ?? []).map((e) => e.id);
    const fieldsRes = entityIds.length
      ? await supabase
          .from('extraction_fields')
          .select('*')
          .in('entity_type_id', entityIds)
          .order('sort_order', {ascending: true})
      : {data: [], error: null};
    if (fieldsRes.error) throw fieldsRes.error;

    const fieldsByEntity = new Map<string, ExtractionField[]>();
    for (const f of fieldsRes.data ?? []) {
      const list = fieldsByEntity.get(f.entity_type_id) ?? [];
      list.push(f as ExtractionField);
      fieldsByEntity.set(f.entity_type_id, list);
    }

    const domains: QADomain[] = (etRes.data ?? []).map((et) => ({
      entityType: et as ExtractionEntityType,
      fields: fieldsByEntity.get(et.id) ?? [],
    }));

    return {template: tplRes.data as QATemplate, domains};
  }, 'qaTemplateService.loadGlobalQATemplate');
}

// ---------------------------------------------------------------------------
// useProjectQATemplate: load a project-scoped QA template + entity types
// ---------------------------------------------------------------------------

/**
 * Load a project-scoped QA template (from project_extraction_templates)
 * together with its entity types and nested fields. Validates that the
 * template kind is "quality_assessment".
 *
 * NOTE: error messages are stored in hook state, not shown as toasts.
 */
export function loadProjectQATemplate(
  projectTemplateId: string,
): Promise<ErrorResult<QATemplateWithDomains>> {
  return toResult(async () => {
    const tplRes = await supabase
      .from('project_extraction_templates')
      .select('id, name, description, framework, version, kind')
      .eq('id', projectTemplateId)
      .maybeSingle();
    if (tplRes.error) throw tplRes.error;
    if (!tplRes.data) throw new Error('Project template not found');
    if (tplRes.data.kind !== 'quality_assessment') {
      throw new Error(
        `Template kind '${tplRes.data.kind}' is not 'quality_assessment'`,
      );
    }

    const etRes = await supabase
      .from('extraction_entity_types')
      .select('*, extraction_fields(*)')
      .eq('project_template_id', projectTemplateId)
      .order('sort_order', {ascending: true});
    if (etRes.error) throw etRes.error;

    const entities = (etRes.data as EntityTypeWithFields[] | null) ?? [];
    const domains: QADomain[] = entities.map((et) => ({
      entityType: et as ExtractionEntityType,
      fields: ([...(et.extraction_fields ?? [])].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
      )) as ExtractionField[],
    }));

    return {template: tplRes.data as QATemplate, domains};
  }, 'qaTemplateService.loadProjectQATemplate');
}

// ---------------------------------------------------------------------------
// useHITLProjectTemplates: fetch project and global templates
// ---------------------------------------------------------------------------

export interface ProjectTemplateRow {
  id: string;
  project_id: string;
  global_template_id: string | null;
  name: string;
  description: string | null;
  framework: string;
  version: string;
  kind: string;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
}

export interface GlobalTemplateRow {
  id: string;
  name: string;
  description: string | null;
  framework: string;
  version: string;
  kind: string;
}

/**
 * Fetch project-scoped extraction templates filtered by kind.
 * Pass includeInactive=true to include templates with is_active=false.
 *
 * NOTE: throws on error — callers (useHITLProjectTemplates callbacks)
 * handle via their own try/catch inside useCallback.
 */
export type HITLKindParam = ReviewKind;

export function fetchProjectTemplates(
  projectId: string,
  kind: HITLKindParam,
  includeInactive: boolean,
): Promise<ErrorResult<ProjectTemplateRow[]>> {
  return toResult(async () => {
    let query = supabase
      .from('project_extraction_templates')
      .select('*')
      .eq('project_id', projectId)
      .eq('kind', kind)
      .order('created_at', {ascending: false});
    if (!includeInactive) {
      query = query.eq('is_active', true);
    }
    const {data, error: queryError} = await query;
    if (queryError) throw queryError;
    return (data ?? []) as ProjectTemplateRow[];
  }, 'qaTemplateService.fetchProjectTemplates');
}

/**
 * Fetch all global templates of a given kind ordered by name.
 *
 * NOTE: throws on error — callers (useHITLProjectTemplates callbacks)
 * handle via their own try/catch inside useCallback.
 */
export function fetchGlobalTemplates(
  kind: HITLKindParam,
): Promise<ErrorResult<GlobalTemplateRow[]>> {
  return toResult(async () => {
    const {data, error: queryError} = await supabase
      .from('extraction_templates_global')
      .select('id, name, description, framework, version, kind')
      .eq('kind', kind)
      .order('name', {ascending: true});
    if (queryError) throw queryError;
    return (data ?? []) as GlobalTemplateRow[];
  }, 'qaTemplateService.fetchGlobalTemplates');
}

// ---------------------------------------------------------------------------
// useQAAssessmentSession: open or resume a QA session
// ---------------------------------------------------------------------------

export interface OpenQASessionBody {
  project_id: string;
  article_id: string;
  global_template_id?: string;
  project_template_id?: string;
}

export interface OpenQASessionResponse {
  run_id: string;
  project_template_id: string;
  instances_by_entity_type: Record<string, string>;
}

/**
 * POST /api/v1/hitl/sessions with kind=quality_assessment to open or
 * resume a QA assessment session.
 *
 * NOTE: error messages are stored in hook state, not shown as toasts.
 */
export function openQASession(
  body: OpenQASessionBody,
): Promise<ErrorResult<OpenQASessionResponse>> {
  return toResult(async () => {
    const data = await apiClient<OpenQASessionResponse>('/api/v1/hitl/sessions', {
      method: 'POST',
      body: {kind: 'quality_assessment', ...body},
    });
    return data;
  }, 'qaTemplateService.openQASession');
}
