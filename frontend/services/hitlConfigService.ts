/**
 * HITL configuration service — talks to the backend CRUD endpoints
 * that back the Project Settings → Review consensus UI.
 *
 * The backend returns a single resolved view per request: even when no
 * row exists at the requested scope, the response carries the
 * fallback (project or system_default) plus an `inherited` flag.
 */

import { apiClient } from '@/integrations/api';

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
