/**
 * What the open draft would publish, bucketed by tier (slice B-9b2a).
 *
 * Read-only and mounted per sheet open, so there is no invalidation
 * contract here: the sheet asks once when it opens and the answer dies
 * with it.
 *
 * @module hooks/extraction/useTemplateConfigDiff
 */
import {useQuery} from '@tanstack/react-query';

import {templateDiffKeys} from '@/lib/query-keys/extraction';
import {
  loadTemplateConfigDiff,
  type TemplateConfigDiff,
} from '@/services/templateService';

export function useTemplateConfigDiff(projectId: string, templateId: string) {
  const enabled = Boolean(projectId && templateId);
  const query = useQuery<TemplateConfigDiff, Error>({
    queryKey: templateDiffKeys.byTemplate(projectId, templateId),
    queryFn: async () => {
      const result = await loadTemplateConfigDiff(projectId, templateId);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    enabled,
  });
  // TanStack keeps `isPending` true for a disabled query — with no id it
  // would never fire, so "Reading the changes…" must not render forever.
  return {...query, isPending: enabled && query.isPending};
}
