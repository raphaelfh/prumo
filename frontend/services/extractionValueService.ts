/**
 * Extraction value service — HITL-native replacement for the legacy
 * `extracted_values` table.
 *
 * - Reads project the latest `ReviewerDecision` per (run, reviewer,
 *   instance, field) by joining `extraction_reviewer_states` (current
 *   decision pointer) with `extraction_reviewer_decisions` (the value).
 * - Writes go through `/v1/runs/{runId}/decisions` so the run lifecycle
 *   constraints (stage=review, source_user_id, append-only) are enforced
 *   in one place.
 *
 * The "active extraction run" for an (article × project_template) pair
 * is resolved here: the latest non-finalized, non-cancelled run. Section
 * extraction now auto-advances to REVIEW after recording AI proposals,
 * so by the time the form opens, decisions can be written immediately.
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
   * Resolve the active extraction run for (article × project_template).
   * Picks the most recent run still in flight (stage in pending /
   * proposal / review / consensus). Returns `null` if none — the UI
   * should treat that as "AI extraction hasn't run yet".
   *
   * Always filters by `kind='extraction'` so a Quality-Assessment run on
   * the same article can never leak into the extraction surface — both
   * kinds share `extraction_runs`, and the autosave/auto-resolve must
   * not coordinate-mismatch by picking a QA run with foreign instances.
   */
  async findActiveRun(
    articleId: string,
    projectTemplateId: string | null,
  ): Promise<RunRef | null> {
    const qs = projectTemplateId ? `?template_id=${projectTemplateId}` : '';
    const data = await apiClient<RunSummaryResponse | null>(
      `/api/v1/articles/${articleId}/active-run${qs}`,
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
   * Resolve the latest finalized run for (article × project_template).
   * Used purely for reopen detection on the extraction page — the
   * "Reopen for revision" button only renders when this returns a row
   * and `findActiveRun` returns null. The returned id is then passed
   * to `useReopenRun` which spawns a fresh REVIEW-stage run that seeds
   * proposals from the published values. Same `kind='extraction'`
   * guard as ``findActiveRun``.
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

  /**
   * Record a user's edit as a ReviewerDecision (decision='edit').
   * Server enforces run.stage=review and append-only semantics.
   */
  async saveValue(
    runId: string,
    instanceId: string,
    fieldId: string,
    value: unknown,
    rationale: string | null = null,
  ): Promise<void> {
    await apiClient(`/api/v1/runs/${runId}/decisions`, {
      method: 'POST',
      body: {
        instance_id: instanceId,
        field_id: fieldId,
        decision: 'edit',
        value: { value: value ?? null },
        rationale: rationale ?? undefined,
      },
    });
  },

  /**
   * Record acceptance of an AI proposal: ReviewerDecision with
   * decision='accept_proposal' and the proposal_record_id.
   */
  async acceptProposal(
    runId: string,
    instanceId: string,
    fieldId: string,
    proposalRecordId: string,
  ): Promise<void> {
    await apiClient(`/api/v1/runs/${runId}/decisions`, {
      method: 'POST',
      body: {
        instance_id: instanceId,
        field_id: fieldId,
        decision: 'accept_proposal',
        proposal_record_id: proposalRecordId,
      },
    });
  },

  /**
   * Mark this user's stance as "reject" — clears the value from the
   * reviewer_state pointer. The historical decision row stays for audit.
   */
  async rejectValue(
    runId: string,
    instanceId: string,
    fieldId: string,
  ): Promise<void> {
    await apiClient(`/api/v1/runs/${runId}/decisions`, {
      method: 'POST',
      body: {
        instance_id: instanceId,
        field_id: fieldId,
        decision: 'reject',
      },
    });
  },
};

