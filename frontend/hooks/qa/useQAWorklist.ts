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
 * assessment — the caller simply falls back to its end-of-queue destination
 * and the header pager (which self-guards below two articles) renders nothing.
 *
 * The title rides along with the id because the header's article pager and the
 * ⌘K palette both name the article they navigate to.
 */

import { useEffect, useState } from 'react';
import { fetchProjectArticles } from '@/services/articlesService';
import { t } from '@/lib/copy';

export interface QAWorklistItem {
  id: string;
  title: string;
}

export function useQAWorklist(projectId: string | undefined): QAWorklistItem[] {
  const [articles, setArticles] = useState<QAWorklistItem[]>([]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void fetchProjectArticles(projectId).then((result) => {
      if (cancelled || !result.ok) return;
      // `articles.title` is nullable in the schema. The pager and the palette
      // both NAME the article they navigate to, so an untitled row gets the
      // same placeholder the QA article table already shows it under.
      setArticles(
        result.data.map((a) => ({
          id: a.id,
          title: a.title ?? t('qa', 'untitledArticle'),
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return articles;
}
