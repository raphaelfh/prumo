/**
 * Extraction value service — run-reference reads for the extraction
 * surfaces (reopen detection). All decision
 * WRITES live in `extractionRunService.writeRunFieldValue` (the autosave
 * path); the old direct accept/reject/save writers were removed with the
 * dead `acceptStrategy` chain, and the `unwrapValue` peel went with its
 * last consumer (the QA proposals read path, D8 2026-07-05).
 */
import { apiClient } from '@/integrations/api';
import type { RunSummaryResponse } from '@/hooks/runs/types';

export interface RunRef {
  id: string;
  stage: string;
  status: string;
  template_id: string;
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
};

