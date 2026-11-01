/**
 * Title/abstract screening service. Every call routes through the typed
 * client and returns `ErrorResult<T>` — never throws across the boundary,
 * never toasts. The `ApiError` (`code`, `status`) comes back intact as
 * `error`; `screeningErrorMessage` (`lib/screening/errors.ts`) words it.
 */

import {apiClient} from '@/integrations/api/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

export type ScreeningConfigRead = components['schemas']['ScreeningConfigRead'];
export type ScreeningConfigUpdate = components['schemas']['ScreeningConfigUpdate'];
/** `phase` defaults to `title_abstract` on the server. */
export type ScreeningEnrollRequest = Partial<components['schemas']['ScreeningEnrollRequest']>;
export type ScreeningEnrollResult = components['schemas']['ScreeningEnrollResult'];
export type PubmedDryRunRead = components['schemas']['PubmedDryRunRead'];
export type PubmedImportStarted = components['schemas']['PubmedImportStarted'];
export type ImportRunRead = components['schemas']['ImportRunRead'];
export type ScreeningAssignmentRead = components['schemas']['ScreeningAssignmentRead'];
export type ScreeningDecisionCreate = components['schemas']['ScreeningDecisionCreate'];
export type ScreeningArbitrationCreate = components['schemas']['ScreeningArbitrationCreate'];
export type PrismaCountsRead = components['schemas']['PrismaCountsRead'];
export type ScreeningRecordsRead = components['schemas']['ScreeningRecordsRead'];
export type ScreeningRecordRow = components['schemas']['ScreeningRecordRow'];
export type ScreeningPhase = ScreeningRecordsRead['phase'];

export function fetchScreeningConfig(projectId: string): Promise<ErrorResult<ScreeningConfigRead>> {
  return toResult(
    () => apiClient<ScreeningConfigRead>(`/api/v1/projects/${projectId}/screening/config`),
    'screeningService.fetchScreeningConfig',
  );
}

/** 409 SCREENING_CONFIG_FROZEN after the first decision; 409 SCREENING_TOO_FEW_REVIEWERS above `reviewer_capable`. */
export function setScreeningConfig(
  projectId: string,
  body: ScreeningConfigUpdate,
): Promise<ErrorResult<ScreeningConfigRead>> {
  return toResult(
    () =>
      apiClient<ScreeningConfigRead>(`/api/v1/projects/${projectId}/screening/config`, {
        method: 'PUT',
        body,
      }),
    'screeningService.setScreeningConfig',
  );
}

/** No `article_ids` enrolls every project article not yet enrolled. */
export function enrollArticles(
  projectId: string,
  body: ScreeningEnrollRequest,
): Promise<ErrorResult<ScreeningEnrollResult>> {
  return toResult(
    () =>
      apiClient<ScreeningEnrollResult>(`/api/v1/projects/${projectId}/screening/enroll`, {
        method: 'POST',
        body,
      }),
    'screeningService.enrollArticles',
  );
}

/** Counts only, nothing written. 422 VALIDATION_ERROR when the server refuses the list. */
export function dryRunPubmedImport(
  projectId: string,
  pmids: string[],
): Promise<ErrorResult<PubmedDryRunRead>> {
  return toResult(
    () =>
      apiClient<PubmedDryRunRead>(`/api/v1/projects/${projectId}/imports/pubmed`, {
        method: 'POST',
        body: {pmids, dry_run: true},
      }),
    'screeningService.dryRunPubmedImport',
  );
}

/** 202 with the run to poll; 503 NCBI_EMAIL_NOT_CONFIGURED / SERVICE_UNAVAILABLE when it cannot start. */
export function startPubmedImport(
  projectId: string,
  pmids: string[],
): Promise<ErrorResult<PubmedImportStarted>> {
  return toResult(
    () =>
      apiClient<PubmedImportStarted>(`/api/v1/projects/${projectId}/imports/pubmed`, {
        method: 'POST',
        body: {pmids, dry_run: false},
      }),
    'screeningService.startPubmedImport',
  );
}

/** 404 when the run is missing, in another project, or another requester's. */
export function fetchImportRun(projectId: string, syncRunId: string): Promise<ErrorResult<ImportRunRead>> {
  return toResult(
    () => apiClient<ImportRunRead>(`/api/v1/projects/${projectId}/imports/${syncRunId}`),
    'screeningService.fetchImportRun',
  );
}

/**
 * Every project article in the phase, in queue order, as the caller may see it.
 * 409 SCREENING_NOT_CONFIGURED (the UI gates on the config read and never sends it then); 403 non-member.
 */
export function fetchScreeningRecords(
  projectId: string,
  phase: ScreeningPhase,
): Promise<ErrorResult<ScreeningRecordsRead>> {
  return toResult(
    () =>
      apiClient<ScreeningRecordsRead>(
        `/api/v1/projects/${projectId}/screening/records?phase=${encodeURIComponent(phase)}`,
      ),
    'screeningService.fetchScreeningRecords',
  );
}

/** One record as the caller may see it; peers stay hidden until there is an outcome. 404 missing, 403 non-member. */
export function fetchAssignment(assignmentId: string): Promise<ErrorResult<ScreeningAssignmentRead>> {
  return toResult(
    () => apiClient<ScreeningAssignmentRead>(`/api/v1/screening/assignments/${assignmentId}`),
    'screeningService.fetchAssignment',
  );
}

/** 409 SCREENING_REVIEWER_CAP / SCREENING_UNKNOWN_EXCLUSION_REASON / SCREENING_NOT_CONFIGURED; 403 for a viewer. */
export function submitDecision(
  assignmentId: string,
  body: ScreeningDecisionCreate,
): Promise<ErrorResult<ScreeningAssignmentRead>> {
  return toResult(
    () =>
      apiClient<ScreeningAssignmentRead>(`/api/v1/screening/assignments/${assignmentId}/decisions`, {
        method: 'POST',
        body,
      }),
    'screeningService.submitDecision',
  );
}

/**
 * 409 SCREENING_STALE_DECISIONS when the decisions changed since the list
 * loaded; 409 SCREENING_NOT_IN_CONFLICT / SCREENING_UNKNOWN_EXCLUSION_REASON; 404 for a foreign decision id.
 */
export function submitArbitration(
  assignmentId: string,
  body: ScreeningArbitrationCreate,
): Promise<ErrorResult<ScreeningAssignmentRead>> {
  return toResult(
    () =>
      apiClient<ScreeningAssignmentRead>(`/api/v1/screening/assignments/${assignmentId}/arbitration`, {
        method: 'POST',
        body,
      }),
    'screeningService.submitArbitration',
  );
}

/** The PRISMA identification and screening numbers. Outcomes only: no pending or in-conflict count. 403 for a non-member. */
export function fetchPrismaCounts(projectId: string): Promise<ErrorResult<PrismaCountsRead>> {
  return toResult(
    () => apiClient<PrismaCountsRead>(`/api/v1/projects/${projectId}/prisma`),
    'screeningService.fetchPrismaCounts',
  );
}
