/**
 * Extraction value service — run-reference reads for the extraction
 * surfaces (reopen detection, batch form-run resolution) plus the shared
 * value-envelope peel. All decision WRITES live in
 * `extractionRunService.writeRunFieldValue` (the autosave path); the old
 * direct accept/reject/save writers were removed with the dead
 * `acceptStrategy` chain (2026-07-05 verify-then-prune).
 */
import { apiClient } from '@/integrations/api';
import { unwrapValueEnvelope } from '@/lib/extraction/valueSemantics';
import type { RunSummaryResponse, ArticleRunRef } from '@/hooks/runs/types';

export interface RunRef {
  id: string;
  stage: string;
  status: string;
  template_id: string;
}

export function unwrapValue(raw: unknown): unknown {
  // One shared peel; a null/absent envelope collapses to null as before.
  if (raw === null || raw === undefined) return null;
  return unwrapValueEnvelope(raw) ?? null;
}

export const ExtractionValueService = {
  /**
   * Resolve the latest finalized run for (article × project_template).
   * Used purely for reopen detection on the extraction page — the
   * "Reopen for revision" button only renders when this returns a row
   * and the HITL session exposes no active run. The returned id is then
   * passed to `useReopenRun` which spawns a fresh extract-stage run that
   * seeds proposals from the published values. Filters by
   * `kind='extraction'` so a QA run on the same article never leaks in.
   */
  async findLatestFinalizedRun(
    articleId: string,
    projectTemplateId: string | null,
  ): Promise<RunRef | null> {
    const qs = projectTemplateId ? `?template_id=${projectTemplateId}` : '';
    const data = await apiClient<RunSummaryResponse | null>(
      `/api/v1/articles/${articleId}/finalized-run${qs}`,
    );
    if (!data) return null;
    return {
      id: data.id,
      stage: data.stage,
      status: data.status,
      template_id: data.template_id,
    };
  },

  /**
   * Resolve the "form run" per article in a batch. The form run is
   * the one ``HITLSessionService.open_or_resume`` would expose: the
   * latest non-terminal (pending/proposal/review/consensus) run if any,
   * otherwise the latest finalized run. Cancelled runs are excluded.
   *
   * Used by views that need run-scoped value queries across multiple
   * articles (e.g. the article extraction badge), so they do not
   * cross-aggregate values from unrelated runs sharing the same
   * instance ids.
   *
   * Short-circuits on empty ``articleIds`` to avoid an unconstrained
   * round trip.
   */
  async findFormRunsByArticle(
    articleIds: string[],
    projectTemplateId: string,
    projectId: string,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (articleIds.length === 0) return result;

    const refs = await apiClient<ArticleRunRef[]>('/api/v1/articles/form-runs', {
      method: 'POST',
      body: {
        article_ids: articleIds,
        template_id: projectTemplateId,
        project_id: projectId,
      },
    });

    for (const ref of refs ?? []) {
      if (ref.run_id != null) {
        result.set(ref.article_id, ref.run_id);
      }
    }
    return result;
  },

};

