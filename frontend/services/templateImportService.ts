/**
 * Global → project template import and related helpers.
 *
 * Import is **server-authoritative**: the browser must not insert
 * `project_extraction_templates` directly (DB invariant: active version required).
 *
 * Flow: validate the global row exists (Supabase read), then call the clone API.
 *
 * @module services/templateImportService
 */

import {supabase} from '@/integrations/supabase/client';
import {ApiError, apiClient} from '@/integrations/api/client';
import {t} from '@/lib/copy';
import {generateSnakeCaseName} from '@/lib/extraction/slug';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

// --- Types ---

export interface ImportResult {
  success: boolean;
  templateId?: string;
  error?: string;
  details?: {
    entityTypesAdded: number;
    fieldsAdded: number;
  };
}

type CloneTemplateResponse = components['schemas']['CloneTemplateResponse'];

/**
 * Import a global extraction template into a project (idempotent on the server).
 *
 * 1. Require an authenticated Supabase user (for API JWT).
 * 2. Load `extraction_templates_global` so we fail fast if the id is missing.
 * 3. `POST /api/v1/projects/{projectId}/templates/clone` with `kind: extraction`.
 *
 * Returns counts from the server (totals for the clone after the call, not a delta).
 */
export async function importGlobalTemplate(
  projectId: string,
  globalTemplateId: string
): Promise<ImportResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error(t('common', 'errors_userNotAuthenticated'));

    console.warn('[templateImport] project', projectId, 'global', globalTemplateId);

    const { data: globalTemplate, error: templateError } = await supabase
      .from('extraction_templates_global')
      .select('*')
      .eq('id', globalTemplateId)
      .single();

    if (templateError) throw templateError;
    if (!globalTemplate) throw new Error(t('common', 'errors_templateNotFound'));

    console.warn(`[templateImport] catalogue: ${globalTemplate.name} v${globalTemplate.version}`);

    const serverCloneResult = await apiClient<CloneTemplateResponse>(
      `/api/v1/projects/${projectId}/templates/clone`,
      {
        method: 'POST',
        body: { global_template_id: globalTemplateId, kind: 'extraction' },
        // Clone can run long over WAN + pooler (heal path, many flushes). Align
        // with Gunicorn `-t` on Render (see render.yaml).
        timeout: 120_000,
      },
    );

    return {
      success: true,
      templateId: serverCloneResult.project_template_id,
      details: {
        entityTypesAdded: serverCloneResult.entity_type_count,
        fieldsAdded: serverCloneResult.field_count,
      },
    };
  } catch (err: any) {
    console.error('[templateImport] failed', err);
    return {
      success: false,
      error: err.message || t('common', 'errors_unknownError'),
    };
  }
}

/**
 * Create one `extraction_instances` row per root entity type with `cardinality='one'`.
 *
 * Skips types under a parent (`parent_entity_type_id` set). Ignores duplicate
 * inserts so the call is safe to retry.
 */
export async function createInitialInstances(
  projectId: string,
  articleId: string,
  templateId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.warn('[templateImport] createInitialInstances for template', templateId);

    const { data: entityTypes, error: etError } = await supabase
      .from('extraction_entity_types')
      .select('id, name, label, cardinality, parent_entity_type_id')
      .eq('project_template_id', templateId)
      .eq('cardinality', 'one')
      .is('parent_entity_type_id', null);

    if (etError) throw etError;

    for (const et of entityTypes || []) {
      const { error: insertError } = await supabase
        .from('extraction_instances')
        .insert({
          project_id: projectId,
          article_id: articleId,
          template_id: templateId,
          entity_type_id: et.id,
          parent_instance_id: null,
          label: et.label,
          sort_order: 0,
          created_by: userId,
        });

      // Detect unique-constraint violations by PostgreSQL SQLSTATE, not by
      // matching the human-readable message — `lc_messages` is locale-dependent
      // and other errors can incidentally contain the word "duplicate".
      // PostgreSQL `unique_violation` is SQLSTATE 23505.
      if (insertError && insertError.code !== '23505') {
        throw insertError;
      }
    }

    console.warn('[templateImport] initial instances done');
    return { success: true };
  } catch (err: any) {
    console.error('[templateImport] createInitialInstances error', err);
    return {
      success: false,
      error: err.message,
    };
  }
}

// --- Portable import/export (prumo-template@1) ---

export type PortableTemplateDoc = components['schemas']['PortableTemplate'];
export type PortableIssue = components['schemas']['TemplatePortableIssue'];

/** `<slug>.prumo-template.json`; falls back to `template` for an empty slug. */
export function templateExportFilename(name: string): string {
  const slug = generateSnakeCaseName(name).replace(/_/g, '-');
  return `${slug || 'template'}.prumo-template.json`;
}

/** The export endpoint returns the document as `data`; the caller writes
 * THAT to disk — never the envelope (the importer is `extra="forbid"`). */
export function exportTemplate(
  projectId: string,
  templateId: string,
): Promise<ErrorResult<PortableTemplateDoc>> {
  return toResult(
    () =>
      apiClient<PortableTemplateDoc>(
        `/api/v1/projects/${projectId}/templates/${templateId}/export`,
        {method: 'GET'},
      ),
    'templateImportService.exportTemplate',
  );
}

export interface FileImportResult {
  templateId: string;
  entityTypesAdded: number;
  fieldsAdded: number;
}

/** Read → JSON.parse (syntax only — the SERVER validates the document) → POST. */
export function importTemplateFromFile(
  projectId: string,
  file: File,
): Promise<ErrorResult<FileImportResult>> {
  return toResult(async () => {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(t('templateConfig', 'importFileNotJson'));
    }
    const result = await apiClient<CloneTemplateResponse>(
      `/api/v1/projects/${projectId}/templates/import`,
      {method: 'POST', body: parsed, timeout: 120_000},
    );
    return {
      templateId: result.project_template_id,
      entityTypesAdded: result.entity_type_count,
      fieldsAdded: result.field_count,
    };
  }, 'templateImportService.importTemplateFromFile');
}

export function deleteTemplate(projectId: string, templateId: string): Promise<ErrorResult<void>> {
  return toResult(async () => {
    await apiClient<components['schemas']['TemplateDeleteResponse']>(
      `/api/v1/projects/${projectId}/templates/${templateId}`,
      {method: 'DELETE'},
    );
  }, 'templateImportService.deleteTemplate');
}

/** The typed issue list a 422 refusal carries (`TemplatePortableRefusalDetails`), or null. */
export function portableIssuesFromError(error: unknown): PortableIssue[] | null {
  if (!(error instanceof ApiError)) return null;
  const errors = error.details?.errors;
  return Array.isArray(errors) ? (errors as PortableIssue[]) : null;
}
