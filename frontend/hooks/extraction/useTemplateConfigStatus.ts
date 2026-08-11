/**
 * Draft/publish status for the Configuration tab's chip (slice B-4).
 *
 * `has_pending_changes` mirrors the DB draft marker every config edit
 * stamps; every config mutation invalidates this key
 * (useTemplateConfigCaches), so the chip tracks edits live.
 *
 * @module hooks/extraction/useTemplateConfigStatus
 */
import {useQuery} from '@tanstack/react-query';

import {templateConfigStatusKeys} from '@/lib/query-keys/extraction';
import {
  loadTemplateConfigStatus,
  type TemplateConfigStatus,
} from '@/services/templateService';

export function useTemplateConfigStatus(projectId: string, templateId: string) {
  return useQuery<TemplateConfigStatus, Error>({
    queryKey: templateConfigStatusKeys.byTemplate(projectId, templateId),
    queryFn: async () => {
      const result = await loadTemplateConfigStatus(projectId, templateId);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    enabled: Boolean(projectId && templateId),
  });
}
