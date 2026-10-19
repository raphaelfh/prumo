/**
 * The run lifecycle endpoints (`/api/v1/runs/{runId}/...`) both run screens
 * drive: the run view read and the stage commands (ready, advance, consensus,
 * approve-finalize, reopen, reopen-extraction).
 *
 * Every call returns `ErrorResult<T>` — never throws across the boundary,
 * never toasts. Cache invalidation and presentation belong to the one caller,
 * `useRunLifecycleScreen`.
 */

import { apiClient } from '@/integrations/api';
import { toResult, type ErrorResult } from '@/lib/error-utils';
import type {
  AdvanceStageRequest,
  ApproveFinalizeResponse,
  ConsensusResultResponse,
  CreateConsensusRequest,
  MarkReadyRequest,
  RunReadyStateResponse,
  RunSummaryResponse,
  RunViewResponse,
} from '@/hooks/runs/types';

const runPath = (runId: string, action: string) => `/api/v1/runs/${runId}/${action}`;

function post<T>(runId: string, action: string, body?: object): Promise<ErrorResult<T>> {
  return toResult(
    () => apiClient<T>(runPath(runId, action), body === undefined ? { method: 'POST' } : { method: 'POST', body }),
    `runLifecycleService.${action}`,
  );
}

/**
 * GET /runs/{id}/view — the run aggregate both screens render from, and the
 * fresh decision authority `useRunValues` re-reads before a reversal.
 */
export function fetchRunView(runId: string): Promise<ErrorResult<RunViewResponse>> {
  return toResult(() => apiClient<RunViewResponse>(runPath(runId, 'view')), 'runLifecycleService.view');
}

export const runLifecycleService = {
  /** Per-reviewer ready flag — advisory, never advances the run. */
  markReady: (runId: string, body: MarkReadyRequest) =>
    post<RunReadyStateResponse>(runId, 'ready', body),
  advance: (runId: string, body: AdvanceStageRequest) =>
    post<RunSummaryResponse>(runId, 'advance', body),
  /** Record one consensus decision (and its published state). */
  createConsensus: (runId: string, body: CreateConsensusRequest) =>
    post<ConsensusResultResponse>(runId, 'consensus', body),
  /** Publish every agreed coord, then consensus → finalized, atomically (ADR-0015). */
  approveFinalize: (runId: string) => post<ApproveFinalizeResponse>(runId, 'approve-finalize'),
  /** Fork a new EXTRACT-stage child run from a finalized one. */
  reopen: (runId: string) => post<RunSummaryResponse>(runId, 'reopen'),
  /** Send a consensus run back to extract, discarding its consensus work (ADR-0017). */
  reopenExtraction: (runId: string) => post<RunSummaryResponse>(runId, 'reopen-extraction'),
};
