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

export interface ExtractForRunResult {
  extractionRunId: string;
  totalSections: number;
  successfulSections: number;
  failedSections: number;
  totalSuggestionsCreated: number;
  totalTokensUsed: number;
  durationMs: number;
}

/**
 * POST /api/v1/extraction/sections for an already-open run.
 * Returns ErrorResult — never throws.
 */
export function extractForRun(
  params: ExtractForRunRequest,
): Promise<ErrorResult<ExtractForRunResult>> {
  return toResult(
    () =>
      apiClient<ExtractForRunResult>('/api/v1/extraction/sections', {
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
      }),
    'extractionRunService.extractForRun',
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
  const {runId, instanceId, fieldId, normalizedValue, useDecisionEndpoint} = params;
  const endpoint = useDecisionEndpoint
    ? `/api/v1/runs/${runId}/decisions`
    : `/api/v1/runs/${runId}/proposals`;
  const body = useDecisionEndpoint
    ? {
        instance_id: instanceId,
        field_id: fieldId,
        decision: 'edit' as const,
        value: {value: normalizedValue},
      }
    : {
        instance_id: instanceId,
        field_id: fieldId,
        source: 'human' as const,
        proposed_value: {value: normalizedValue},
      };
  await apiClient(endpoint, {method: 'POST', body, keepalive: true});
}
