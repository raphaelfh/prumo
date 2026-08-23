/**
 * Global → project template import and related helpers.
 *
 * Import is **server-authoritative**: the browser must not insert
 * `project_extraction_templates` directly (DB invariant: active version required).
 *
 * Every function here speaks to the backend through `apiClient` only.
 *
 * @module services/templateImportService
 */

import {ApiError, apiClient} from '@/integrations/api/client';
import {t} from '@/lib/copy';
import {generateSnakeCaseName} from '@/lib/extraction/slug';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

// --- Types ---

type CloneTemplateResponse = components['schemas']['CloneTemplateResponse'];

/**
 * Import a global extraction template into a project (idempotent on the server).
 *
 * `POST /api/v1/projects/{projectId}/templates/clone` with `kind: extraction`;
 * an unknown catalogue id is the server's 404 (no browser-side pre-read — one
 * read path). Returns counts from the server (totals for the clone after the
 * call, not a delta).
 */
export function importGlobalTemplate(
  projectId: string,
  globalTemplateId: string,
): Promise<ErrorResult<ImportedTemplate>> {
  return toResult(async () => {
    const result = await apiClient<CloneTemplateResponse>(
      `/api/v1/projects/${projectId}/templates/clone`,
      {
        method: 'POST',
        body: {global_template_id: globalTemplateId, kind: 'extraction'},
        // Clone can run long over WAN + pooler (heal path, many flushes). Align
        // with Gunicorn `-t` on Render (see render.yaml).
        timeout: 120_000,
      },
    );
    return fromCloneResponse(result);
  }, 'templateImportService.importGlobalTemplate');
}

// --- Portable import/export (prumo-template@1) ---

export type PortableTemplateDoc = components['schemas']['PortableTemplate'];
export type PortableIssue = components['schemas']['TemplatePortableIssue'];
export type TemplatePortableRefusalCode = components['schemas']['TemplatePortableRefusalCode'];

/** One shape for the clone AND the file import: both return the server's
 * `CloneTemplateResponse`, so the dialog's success path is the same. */
export interface ImportedTemplate {
  templateId: string;
  entityTypesAdded: number;
  fieldsAdded: number;
}

function fromCloneResponse(result: CloneTemplateResponse): ImportedTemplate {
  return {
    templateId: result.project_template_id,
    entityTypesAdded: result.entity_type_count,
    fieldsAdded: result.field_count,
  };
}

// `satisfies Record<…, true>` makes this exhaustive against the generated
// union: a code added to schema.d.ts but not here fails the build instead of
// silently falling through to a plain Error.
const PORTABLE_REFUSAL_CODE_MAP = {
  TEMPLATE_IMPORT_INVALID: true,
  TEMPLATE_IMPORT_WRONG_KIND: true,
  TEMPLATE_IMPORT_UNSUPPORTED_VERSION: true,
  TEMPLATE_EXPORT_INVALID: true,
} satisfies Record<TemplatePortableRefusalCode, true>;
const PORTABLE_REFUSAL_CODES: ReadonlySet<string> = new Set(Object.keys(PORTABLE_REFUSAL_CODE_MAP));

/**
 * A portable import/export the server deliberately refused (422).
 *
 * Same discipline as `TemplatePublishRefusal` in templateService: a plain
 * `Error` subclass survives `normalizeError`/`toResult` untouched, so the
 * pane branches on `instanceof` and `ApiError` never escapes this directory.
 * `issues` is the typed, runtime-validated `details.errors` list (capped
 * server-side at 20; `errorCount` is the uncapped total).
 */
export class TemplatePortableRefusal extends Error {
  constructor(
    message: string,
    public readonly code: TemplatePortableRefusalCode,
    public readonly issues: readonly PortableIssue[] = [],
    public readonly errorCount: number = issues.length,
  ) {
    super(message);
    this.name = 'TemplatePortableRefusal';
  }
}

/** Runtime-validate `error.details.errors`: entries missing `path` or
 * `message` are dropped rather than rendered as "undefined". */
function parsePortableIssues(details: unknown): PortableIssue[] {
  if (!details || typeof details !== 'object') return [];
  const raw = (details as {errors?: unknown}).errors;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is PortableIssue =>
      !!entry &&
      typeof entry === 'object' &&
      typeof (entry as PortableIssue).path === 'string' &&
      typeof (entry as PortableIssue).message === 'string',
  );
}

/** Re-raise a 422 refusal as the typed class; everything else passes through. */
function rethrowPortableRefusal(error: unknown): never {
  if (error instanceof ApiError && PORTABLE_REFUSAL_CODES.has(error.code)) {
    const issues = parsePortableIssues(error.details);
    const count = (error.details as {error_count?: unknown} | undefined)?.error_count;
    throw new TemplatePortableRefusal(
      error.message,
      error.code as TemplatePortableRefusalCode,
      issues,
      typeof count === 'number' ? count : issues.length,
    );
  }
  throw error;
}

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
      ).catch(rethrowPortableRefusal),
    'templateImportService.exportTemplate',
  );
}

/** Read → JSON.parse (syntax only — the SERVER validates the document) → POST. */
export function importTemplateFromFile(
  projectId: string,
  file: File,
): Promise<ErrorResult<ImportedTemplate>> {
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
    ).catch(rethrowPortableRefusal);
    return fromCloneResponse(result);
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
