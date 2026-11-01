/**
 * Every article's screening stage for the Articles list: ONE phase-less
 * records read shared by every chip through the cache, never one request per
 * row. It reads `screeningKeys.records(projectId)` (the phase-less key), so
 * `invalidateScreening` refetches it after an article write or a decision.
 *
 * Deliberately not `refetchOnMount: 'always'` (unlike the workspace reads):
 * each row mounts an observer, and 50 of them would refetch on every scroll.
 * A 30 s staleTime bounds drift instead. The records read is skipped while
 * screening is unconfigured (it answers 409), and a failed read leaves every
 * chip blank (`toResult` already logged it).
 */
import {useQuery} from '@tanstack/react-query';

import {screeningConfigQueryOptions} from '@/hooks/screening/useScreeningConfig';
import {articleScreeningStage, type ArticleStage} from '@/lib/screening/articleStage';
import {screeningKeys} from '@/lib/query-keys/screening';
import {fetchScreeningRecords, type ScreeningRecordRow} from '@/services/screeningService';

const STALE_TIME_MS = 30_000;

type StagesData = {rows: Map<string, ScreeningRecordRow>; removed: Set<string>};

export function useArticleScreeningStages(projectId: string): {stageOf(articleId: string): ArticleStage | null} {
  const {data: config} = useQuery({...screeningConfigQueryOptions(projectId), staleTime: STALE_TIME_MS});
  const configured = config?.reviewer_count != null;

  const {data} = useQuery({
    queryKey: screeningKeys.records(projectId),
    enabled: configured && Boolean(projectId),
    staleTime: STALE_TIME_MS,
    retry: false,
    // Rebuilding the Map/Set per fetch is the point; structural sharing would walk them for nothing.
    structuralSharing: false,
    queryFn: async (): Promise<StagesData> => {
      const result = await fetchScreeningRecords(projectId);
      if (!result.ok) throw result.error;
      return {
        rows: new Map(result.data.rows.map((row) => [row.article_id, row])),
        removed: new Set(result.data.removed_duplicate_ids),
      };
    },
  });

  const fullTextOn = config?.full_text_reviewer_count != null;
  return {
    stageOf(articleId) {
      if (!configured || !data) return null;
      return articleScreeningStage(data.rows.get(articleId), {
        fullTextOn,
        isDuplicate: data.removed.has(articleId),
      });
    },
  };
}
