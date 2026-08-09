/**
 * What the open draft would publish, bucketed by tier (slice B-9b2a).
 *
 * Read-only, and mounted per sheet open — but a cached answer outlives the
 * unmount, and NOTHING invalidates `templateDiffKeys`. Under the app's
 * 5-minute global `staleTime` (App.tsx) that would let a reopen replay the
 * diff computed before the edits made in between, so the sheet would claim
 * a publish that no longer matches the draft. `staleTime: 0` is what makes
 * "the next open asks the server again" true.
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
    staleTime: 0,
  });
  // Only the two keys the sheet reads. Spreading the query would touch
  // every key of TanStack's tracked proxy, so the sheet would re-render —
  // and rebuild the whole tier accordion — on `isFetching`/`dataUpdatedAt`
  // churn it never displays.
  //
  // `isPending` stays true for a DISABLED query — with no id it would never
  // fire, so "Reading the changes…" must not render forever.
  return {data: query.data, isPending: enabled && query.isPending};
}
