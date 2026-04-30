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

export function useArticleTextBlocks(articleFileId: string | null | undefined) {
  return useQuery({
    queryKey: ['article-text-blocks', articleFileId],
    enabled: Boolean(articleFileId),
    staleTime: STALE_MS,
    queryFn: async (): Promise<ArticleTextBlock[]> => {
      const blocks = await apiClient<ArticleTextBlock[]>(
        `/api/v1/article-files/${articleFileId}/text-blocks`,
      );
      return blocks ?? [];
    },
  });
}
