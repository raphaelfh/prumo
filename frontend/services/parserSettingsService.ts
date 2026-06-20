/**
 * Parser-settings service — typed IO for the per-project parser backend.
 * Throws ApiError on failure (the apiClient contract) — callers handle it.
 */
import { apiClient } from '@/integrations/api';
import type { components } from '@/types/api/schema';

type ParserType = components['schemas']['ParserSettingsPayload']['type'];
type ParserSettingsRead = components['schemas']['ParserSettingsRead'];

export function getParserSettings(projectId: string): Promise<ParserSettingsRead> {
  return apiClient<ParserSettingsRead>(
    `/api/v1/projects/${projectId}/parser-settings`,
  );
}

export function setParserType(
  projectId: string,
  type: ParserType,
): Promise<ParserSettingsRead> {
  const body: components['schemas']['ParserSettingsPayload'] = { type };
  return apiClient<ParserSettingsRead>(
    `/api/v1/projects/${projectId}/parser-settings`,
    { method: 'PUT', body },
  );
}
