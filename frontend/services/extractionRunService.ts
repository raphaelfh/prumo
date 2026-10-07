/**
 * Extraction run service — API calls for run-level AI extraction.
 *
 * Service-layer contract (zero-bailouts spec): exported functions never
 * throw across the boundary; they return ErrorResult<T>. try/catch and
 * throw are free here — module-level functions are not compiled by the
 * React Compiler.
 *
 * @module services/extractionRunService
 */

import {apiClient} from '@/integrations/api';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {ReviewKind} from '@/lib/comparison/permissions';
import type {components} from '@/types/api/schema';

// ---------------------------------------------------------------------------
// useRunAIExtraction
// ---------------------------------------------------------------------------

export interface ExtractForRunRequest {
  projectId: string;
  articleId: string;
  templateId: string;
  runId: string;
  skipFieldsWithHumanProposals?: boolean;
  autoAdvanceToReview?: boolean;
}

/** Shape returned by POST /api/v1/extraction/sections (202 body). */
export interface ExtractForRunResult {
  /** Celery job id; poll via GET /api/v1/extraction/sections/status/{jobId}. */
  jobId: string;
}

/**
 * Typed alias for the status-poll response.
 * Imported from generated schema so the shape never drifts from the backend.
 */
export type ExtractionJobStatus =
  components['schemas']['ExtractionJobStatusResponse'];

/**
 * POST /api/v1/extraction/sections — enqueues the extraction job.
 * Returns ErrorResult<{ jobId }> — never throws.
 * The backend returns 202 with ApiResponse.success({ job_id }) (snake_case).
 */
export function extractForRun(
  params: ExtractForRunRequest,
): Promise<ErrorResult<ExtractForRunResult>> {
  return toResult(
    async () => {
      // apiClient unwraps ApiResponse.data; backend sends { job_id } (snake_case).
      const raw = await apiClient<{ job_id: string }>('/api/v1/extraction/sections', {
        method: 'POST',
        body: {
          projectId: params.projectId,
          articleId: params.articleId,
          templateId: params.templateId,
          runId: params.runId,
          skipFieldsWithHumanProposals: params.skipFieldsWithHumanProposals ?? true,
          autoAdvanceToReview: params.autoAdvanceToReview ?? false,
          // C1a: no `model` key — the engine is server-owned.
        },
      });
      return { jobId: raw.job_id };
    },
    'extractionRunService.extractForRun',
  );
}

/**
 * GET /api/v1/extraction/sections/status/{jobId} — polls job state.
 * Returns ErrorResult<ExtractionJobStatus> — never throws.
 * The status response is already camelCase (jobId, result, status, error).
 */
export function getExtractionJobStatus(
  jobId: string,
): Promise<ErrorResult<ExtractionJobStatus>> {
  return toResult(
    () =>
      apiClient<ExtractionJobStatus>(
        `/api/v1/extraction/sections/status/${encodeURIComponent(jobId)}`,
      ),
    'extractionRunService.getExtractionJobStatus',
  );
}

// ---------------------------------------------------------------------------
// useExtractionSession
// ---------------------------------------------------------------------------

export interface OpenExtractionSessionRequest {
  projectId: string;
  articleId: string;
  projectTemplateId: string;
}

export interface OpenExtractionSessionResult {
  run_id: string;
  kind: ReviewKind;
  project_template_id: string;
  instances_by_entity_type: Record<string, string>;
  run_view: unknown | null;
}

/**
 * POST /api/v1/hitl/sessions with kind=extraction.
 * Returns ErrorResult — never throws.
 */
export function openExtractionSession(
  req: OpenExtractionSessionRequest,
): Promise<ErrorResult<OpenExtractionSessionResult>> {
  return toResult(
    () =>
      apiClient<OpenExtractionSessionResult>('/api/v1/hitl/sessions', {
        method: 'POST',
        body: {
          kind: 'extraction',
          project_id: req.projectId,
          article_id: req.articleId,
          project_template_id: req.projectTemplateId,
        },
      }),
    'extractionRunService.openExtractionSession',
  );
}

// ---------------------------------------------------------------------------
// The autosave queue's single-field write (useRunValues supplies the writer)
// ---------------------------------------------------------------------------

export interface WriteProposalParams {
  runId: string;
  instanceId: string;
  fieldId: string;
  normalizedValue: unknown;
  /**
   * ADR-0016: the coded `absent_reason` disposition to carry in the value
   * envelope (`{value, absent_reason}`). Present only for a resolved "no
   * information" marker; omitted (null/undefined) for every ordinary value so a
   * legacy write never gains a spurious `absent_reason` key.
   */
  absentReason?: string | null;
  /**
   * D0 (consensus AI trace): the accepted/selected AI proposal this coord's
   * value originated from, so the arbitrator can trace an edit back to its AI
   * basis; the backend validates it references a non-human proposal on the
   * same (instance, field).
   */
  proposalRecordId?: string | null;
}

/** Fresh authority and audit history for reversible workspace decisions. */
export function readDecisionAuthority(runId: string) {
  return toResult(
    () => apiClient<import('@/hooks/runs/types').RunViewResponse>(`/api/v1/runs/${runId}/view`),
    'extractionRunService.readDecisionAuthority',
  );
}

/** Append the typed envelope and optional current-decision condition unchanged. */
export function appendReviewerDecision(runId: string, body: components['schemas']['CreateDecisionRequest']) {
  return toResult(
    () => apiClient<import('@/hooks/runs/types').ReviewerDecisionResponse>(`/api/v1/runs/${runId}/decisions`, {
      method: 'POST', body, keepalive: true,
    }),
    'extractionRunService.appendReviewerDecision',
  );
}
