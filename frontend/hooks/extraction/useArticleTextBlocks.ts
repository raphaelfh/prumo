/**
 * Fetches the per-page indexed text blocks for an article file.
 *
 * Drives the PDF viewer's reader-view mode (Phase 5). Returns an empty
 * array for article_files whose ingestion pipeline (Phase 6) hasn't
 * populated `article_text_blocks` yet — the consumer should render an
 * EmptyState in that case rather than a loading spinner forever.
 */
import {useQuery} from '@tanstack/react-query';

import {apiClient} from '@/integrations/api/client';
import {articleKeys} from '@/lib/query-keys';

/**
 * Wire shape mirrored from the backend response (camelCase JSON).
 *
 * `bbox` coordinates are in PDF user space (origin bottom-left, points)
 * — same as `frontend/pdf-viewer/core/coordinates.ts:PDFRect`.
 */
export interface ArticleTextBlock {
  id: string;
  pageNumber: number;
  blockIndex: number;
  text: string;
  charStart: number;
  charEnd: number;
  bbox: {x: number; y: number; width: number; height: number};
  blockType:
    | 'paragraph'
    | 'heading'
    | 'list_item'
    | 'table_cell'
    | 'figure_caption'
    | 'header'
    | 'footer';
}

const STALE_MS = 5 * 60_000;

export interface UseArticleTextBlocksOptions {
  /**
   * Poll interval (ms) while the upstream parse is still running. Pass `false`
   * (the default) once the file is `parsed`/`parse_failed` to stop polling.
   */
  refetchInterval?: number | false;
}

export function useArticleTextBlocks(
  articleFileId: string | null | undefined,
  options: UseArticleTextBlocksOptions = {},
) {
  const enabled = Boolean(articleFileId);
  const query = useQuery({
    queryKey: articleKeys.textBlocks(articleFileId ?? ''),
    enabled,
    staleTime: STALE_MS,
    refetchInterval: options.refetchInterval ?? false,
    queryFn: async (): Promise<ArticleTextBlock[]> => {
      const blocks = await apiClient<ArticleTextBlock[]>(
        `/api/v1/article-files/${articleFileId}/text-blocks`,
      );
      return blocks ?? [];
    },
  });
  // Only the two keys the document model reads (narrow return per
  // useTemplateConfigDiff — spreading TanStack's tracked proxy would touch
  // every key and re-render callers on isFetching churn they never display).
  //
  // isPending, not isLoading, gated by this hook's own enablement: "no data
  // yet" must read as pending even while TanStack pauses an offline query
  // (isLoading false), while a DISABLED query (isPending true forever) must
  // not read as pending at all.
  return {
    data: query.data,
    isPending: enabled && query.isPending,
  };
}
