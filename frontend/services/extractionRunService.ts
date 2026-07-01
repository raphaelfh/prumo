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
  model?: string;
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
          model: params.model ?? 'gpt-4o-mini',
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
// useAutoSaveProposals: single-field proposal / decision write
// ---------------------------------------------------------------------------

export interface WriteProposalParams {
  runId: string;
  instanceId: string;
  fieldId: string;
  normalizedValue: unknown;
  /** When true, writes a ReviewerDecision (extraction in 'extract'); otherwise writes a human proposal. */
  useDecisionEndpoint: boolean;
  /**
   * ADR-0016: the coded `absent_reason` disposition to carry in the value
   * envelope (`{value, absent_reason}`). Present only for a resolved "no
   * information" marker; omitted (null/undefined) for every ordinary value so a
   * legacy write never gains a spurious `absent_reason` key.
   */
  absentReason?: string | null;
}

/**
 * Write a single field value to the run as either a human proposal
 * (/proposals) or a reviewer decision (/decisions), determined by
 * ``useDecisionEndpoint``. Keepalive=true so the request survives route
 * changes and tab closes.
 *
 * NOTE: does not return ErrorResult — the caller (performSave inside
 * useAutoSaveProposals) uses Promise.allSettled to fan out writes and
 * handles failures in aggregate, so individual writes may throw.
 */
export async function writeRunFieldValue(
  params: WriteProposalParams,
): Promise<void> {
  const {runId, instanceId, fieldId, normalizedValue, useDecisionEndpoint, absentReason} =
    params;
  const endpoint = useDecisionEndpoint
    ? `/api/v1/runs/${runId}/decisions`
    : `/api/v1/runs/${runId}/proposals`;
  // Merge the disposition sibling only when present, so an ordinary value never
  // gains a spurious `absent_reason` key (ADR-0016 write contract).
  const valueEnvelope = absentReason
    ? {value: normalizedValue, absent_reason: absentReason}
    : {value: normalizedValue};
  const body = useDecisionEndpoint
    ? {
        instance_id: instanceId,
        field_id: fieldId,
        decision: 'edit' as const,
        value: valueEnvelope,
      }
    : {
        instance_id: instanceId,
        field_id: fieldId,
        source: 'human' as const,
        proposed_value: valueEnvelope,
      };
  await apiClient(endpoint, {method: 'POST', body, keepalive: true});
}
