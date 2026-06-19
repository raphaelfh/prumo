/**
 * HITL configuration service — talks to the backend CRUD endpoints
 * that back the Project Settings → Review consensus UI.
 *
 * The backend returns a single resolved view per request: even when no
 * row exists at the requested scope, the response carries the
 * fallback (project or system_default) plus an `inherited` flag.
 */

import { apiClient } from '@/integrations/api';
import type { ReviewKind } from '@/lib/comparison/permissions';
import type { components } from '@/types/api/schema';

export type ConsensusRule = 'unanimous' | 'majority' | 'arbitrator';
export type HitlConfigScopeKind = 'project' | 'template' | 'system_default';

export interface HitlConfigRead {
  scope_kind: HitlConfigScopeKind;
  scope_id: string | null;
  reviewer_count: number;
  consensus_rule: ConsensusRule;
  arbitrator_id: string | null;
  inherited: boolean;
}

export interface HitlConfigPayload {
  reviewer_count: number;
  consensus_rule: ConsensusRule;
  arbitrator_id: string | null;
}

export const HitlConfigService = {
  getForProject: (projectId: string) =>
    apiClient<HitlConfigRead>(`/api/v1/projects/${projectId}/hitl-config`),

  upsertForProject: (projectId: string, payload: HitlConfigPayload) =>
    apiClient<HitlConfigRead>(`/api/v1/projects/${projectId}/hitl-config`, {
      method: 'PUT',
      body: payload,
    }),

  clearForProject: (projectId: string) =>
    apiClient<HitlConfigRead>(`/api/v1/projects/${projectId}/hitl-config`, {
      method: 'DELETE',
    }),

  getForTemplate: (projectId: string, templateId: string) =>
    apiClient<HitlConfigRead>(
      `/api/v1/projects/${projectId}/templates/${templateId}/hitl-config`,
    ),

  upsertForTemplate: (
    projectId: string,
    templateId: string,
    payload: HitlConfigPayload,
  ) =>
    apiClient<HitlConfigRead>(
      `/api/v1/projects/${projectId}/templates/${templateId}/hitl-config`,
      {
        method: 'PUT',
        body: payload,
      },
    ),

  clearForTemplate: (projectId: string, templateId: string) =>
    apiClient<HitlConfigRead>(
      `/api/v1/projects/${projectId}/templates/${templateId}/hitl-config`,
      {
        method: 'DELETE',
      },
    ),
};

/**
 * Resolved per-kind manager-review-visibility map (one bool per kind).
 * Sourced from the generated API contract — never hand-mirror backend models.
 */
export type ManagerReviewVisibility =
  components['schemas']['ManagerReviewVisibilityRead'];

/**
 * Set whether managers may see other reviewers' values for ONE kind
 * (preserving the other kind server-side). Manager-only on the backend.
 * Throws ApiError on failure (the apiClient contract) — callers handle it.
 */
export function setManagerReviewVisibility(
  projectId: string,
  kind: ReviewKind,
  value: boolean,
): Promise<ManagerReviewVisibility> {
  const body: components['schemas']['ManagerReviewVisibilityPayload'] = {
    kind,
    managers_see_reviewers: value,
  };
  return apiClient<ManagerReviewVisibility>(
    `/api/v1/projects/${projectId}/manager-review-visibility`,
    { method: 'PUT', body },
  );
}
