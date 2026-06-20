/**
 * Next-in-order article id, or null at end-of-queue / unknown current.
 *
 * Status-aware preference ("skip already-ready articles") is deferred: the
 * worklist does not yet carry per-article run status (needs a batch-runs
 * endpoint). See docs/superpowers/specs/2026-06-20-extraction-header-refinement-design.md §10.
 */
export function nextArticleTarget(
  articles: { id: string }[],
  currentId: string,
): string | null {
  const idx = articles.findIndex((a) => a.id === currentId);
  if (idx < 0 || idx >= articles.length - 1) return null;
  return articles[idx + 1].id;
}
