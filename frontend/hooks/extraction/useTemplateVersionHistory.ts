/**
 * The published-version timeline behind the History sheet (B-9e).
 *
 * Mirrors `useTemplateConfigDiff`: `gcTime: 0` so the read dies with the
 * sheet and the next open asks the server again — a timeline that silently
 * served a cached list would hide a version someone else just published.
 *
 * `isPending` is false for a DISABLED query: with no ids the request never
 * fires, so "Loading history…" must not render forever.
 *
 * @module hooks/extraction/useTemplateVersionHistory
 */
import {useQuery} from '@tanstack/react-query';

import {templateVersionHistoryKeys} from '@/lib/query-keys/extraction';
import {
  loadTemplateVersionHistory,
  type TemplateVersionHistory,
} from '@/services/templateService';

export function useTemplateVersionHistory(projectId: string, templateId: string) {
  const enabled = Boolean(projectId && templateId);
  const query = useQuery<TemplateVersionHistory, Error>({
    queryKey: templateVersionHistoryKeys.byTemplate(projectId, templateId),
    queryFn: async () => {
      const result = await loadTemplateVersionHistory(projectId, templateId);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    enabled,
    staleTime: 0,
    gcTime: 0,
  });

  return {
    data: query.data,
    isPending: enabled && query.isPending,
    isError: query.isError,
  };
}
