/**
 * The project's article worklist for the QA screen, in the same order the QA
 * article table lists it (``created_at`` desc, via ``fetchProjectArticles``) —
 * so "next article" after finishing a form means the next row down.
 *
 * The extraction screen gets the equivalent list from ``useExtractionData``;
 * the QA screen has no bootstrap loader of its own, hence this focused read.
 *
 * A failed read resolves to an empty list on purpose and never toasts: the
 * worklist is navigation garnish, and losing it must not disturb finishing an
 * assessment — the caller simply falls back to its end-of-queue destination.
 */

import { useEffect, useState } from 'react';
import { fetchProjectArticles } from '@/services/articlesService';

export function useQAWorklist(projectId: string | undefined): { id: string }[] {
  const [articles, setArticles] = useState<{ id: string }[]>([]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void fetchProjectArticles(projectId).then((result) => {
      if (cancelled || !result.ok) return;
      setArticles(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return articles;
}
