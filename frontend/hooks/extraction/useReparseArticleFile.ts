import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api";
import { t } from "@/lib/copy";
import { articleKeys } from "@/lib/query-keys";

/** Re-enqueue a parse for an ArticleFile and refresh the file list + reader blocks. */
export function useReparseArticleFile(articleId: string) {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, string>({
    mutationFn: (articleFileId) =>
      apiClient(`/api/v1/article-files/${articleFileId}/reparse`, { method: "POST" }),
    onSuccess: (_data, articleFileId) => {
      toast.success(t("pdf", "docReparseQueued"));
      queryClient.invalidateQueries({ queryKey: articleKeys.files(articleId) });
      queryClient.invalidateQueries({ queryKey: articleKeys.textBlocks(articleFileId) });
      // Re-parsing regenerates the stored block-projection markdown (ADR-0013,
      // "the exact text the LLM received"). Unlike files/text-blocks it has no
      // pending-parse poll, so this invalidation is its only recovery path —
      // without it, "view text sent" serves pre-reparse text for up to the
      // 5-minute staleTime.
      queryClient.invalidateQueries({ queryKey: articleKeys.contentMarkdown(articleId) });
    },
    onError: (error) => {
      toast.error(error.message || t("pdf", "docReparseError"));
    },
  });
}
