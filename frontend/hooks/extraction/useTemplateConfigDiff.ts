/**
 * What the open draft would publish, bucketed by tier (slice B-9b2a).
 *
 * Read-only, and mounted per sheet open. `staleTime: 0` makes a reopen ask
 * the server again instead of trusting a diff computed before the edits made
 * in between. `gcTime: 0` matters just as much: without it the cache entry
 * outlives the sheet's unmount for the app's 10-minute default `gcTime`
 * (App.tsx), so a reopen would render that stale diff instantly while the
 * refetch is still in flight. And if that refetch fails, TanStack keeps the
 * old `data` rather than clearing it — so `isError` is returned alongside
 * `data` instead of relying on `data` being undefined to signal failure.
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
    gcTime: 0,
  });
  // Only the three keys the sheet reads. Spreading the query would touch
  // every key of TanStack's tracked proxy, so the sheet would re-render —
  // and rebuild the whole tier accordion — on `isFetching`/`dataUpdatedAt`
  // churn it never displays.
  //
  // `isPending` stays true for a DISABLED query — with no id it would never
  // fire, so "Reading the changes…" must not render forever.
  return {
    data: query.data,
    isPending: enabled && query.isPending,
    isError: query.isError,
  };
}
