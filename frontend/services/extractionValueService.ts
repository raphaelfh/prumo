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
import { supabase } from '@/integrations/supabase/client';
import { apiClient } from '@/integrations/api';
import { APIError } from '@/lib/ai-extraction/errors';

const NON_TERMINAL_STAGES = [
  'pending',
  'proposal',
  'review',
  'consensus',
] as const;

export interface RunRef {
  id: string;
  stage: string;
  status: string;
  template_id: string;
}

export function unwrapValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    return (raw as { value: unknown }).value ?? null;
  }
  return raw;
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
    let query = supabase
      .from('extraction_runs')
      .select('id, stage, status, template_id, created_at')
      .eq('article_id', articleId)
      .eq('kind', 'extraction')
      .in('stage', [...NON_TERMINAL_STAGES])
      .order('created_at', { ascending: false })
      .limit(1);
    if (projectTemplateId) {
      query = query.eq('template_id', projectTemplateId);
    }
    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new APIError(`Failed to load active run: ${error.message}`, undefined, {
        error,
      });
    }
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
    let query = supabase
      .from('extraction_runs')
      .select('id, stage, status, template_id, created_at')
      .eq('article_id', articleId)
      .eq('kind', 'extraction')
      .eq('stage', 'finalized')
      .order('created_at', { ascending: false })
      .limit(1);
    if (projectTemplateId) {
      query = query.eq('template_id', projectTemplateId);
    }
    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new APIError(
        `Failed to load latest finalized run: ${error.message}`,
        undefined,
        { error },
      );
    }
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
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (articleIds.length === 0) return result;

    const { data, error } = await supabase
      .from('extraction_runs')
      .select('id, article_id, stage, created_at')
      .in('article_id', articleIds)
      .eq('kind', 'extraction')
      .eq('template_id', projectTemplateId)
      .order('created_at', { ascending: false });
    if (error) {
      throw new APIError(
        `Failed to load form runs by article: ${error.message}`,
        undefined,
        { error },
      );
    }

    type RunRow = {
      id: string;
      article_id: string;
      stage: string;
      created_at: string;
    };
    const nonTerminal = new Set<string>(NON_TERMINAL_STAGES);
    // Latest-first sort means: for each article, scan rows in order and
    // prefer a non-terminal hit; fall back to the first finalized seen.
    const finalizedFallback = new Map<string, string>();
    for (const row of (data ?? []) as RunRow[]) {
      if (result.has(row.article_id)) continue;
      if (nonTerminal.has(row.stage)) {
        result.set(row.article_id, row.id);
      } else if (row.stage === 'finalized' && !finalizedFallback.has(row.article_id)) {
        finalizedFallback.set(row.article_id, row.id);
      }
      // cancelled is excluded by design.
    }
    for (const [articleId, runId] of finalizedFallback) {
      if (!result.has(articleId)) result.set(articleId, runId);
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
