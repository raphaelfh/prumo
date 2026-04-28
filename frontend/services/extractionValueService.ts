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

export interface DecisionValueRow {
  instanceId: string;
  fieldId: string;
  value: unknown;
  decision: string;
  reviewerId: string;
  decidedAt: string;
}

export interface OtherUserDecisions {
  reviewerId: string;
  reviewerName: string;
  reviewerAvatar?: string | null;
  values: Record<string, unknown>;
  latestDecidedAt: string;
}

interface ReviewerStateRow {
  run_id: string;
  reviewer_id: string;
  instance_id: string;
  field_id: string;
  current_decision_id: string | null;
  reviewer_decision: {
    decision: string;
    value: { value: unknown } | unknown;
    created_at: string;
  } | null;
}

function unwrapValue(raw: unknown): unknown {
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
   */
  async findActiveRun(
    articleId: string,
    projectTemplateId: string | null,
  ): Promise<RunRef | null> {
    let query = supabase
      .from('extraction_runs')
      .select('id, stage, status, template_id, created_at')
      .eq('article_id', articleId)
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
   * Load the current value per (instance, field) for the given user
   * within a run. Latest decision wins via the materialized
   * reviewer_states pointer.
   */
  async loadValuesForUser(
    runId: string,
    reviewerId: string,
  ): Promise<DecisionValueRow[]> {
    const { data, error } = await supabase
      .from('extraction_reviewer_states')
      .select(
        `run_id, reviewer_id, instance_id, field_id, current_decision_id,
         reviewer_decision:current_decision_id (
           decision, value, created_at
         )`,
      )
      .eq('run_id', runId)
      .eq('reviewer_id', reviewerId);
    if (error) {
      throw new APIError(
        `Failed to load reviewer values: ${error.message}`,
        undefined,
        { error },
      );
    }
    const rows = (data ?? []) as unknown as ReviewerStateRow[];
    return rows
      .filter((r) => r.reviewer_decision !== null)
      .map((r) => ({
        instanceId: r.instance_id,
        fieldId: r.field_id,
        value: unwrapValue(r.reviewer_decision?.value ?? null),
        decision: r.reviewer_decision?.decision ?? 'edit',
        reviewerId: r.reviewer_id,
        decidedAt: r.reviewer_decision?.created_at ?? '',
      }));
  },

  /**
   * Load values from other reviewers in the same run, grouped by user.
   * Used by the collaboration/consensus UI to show divergence.
   */
  async loadValuesForOthers(
    runId: string,
    currentReviewerId: string,
  ): Promise<OtherUserDecisions[]> {
    const { data, error } = await supabase
      .from('extraction_reviewer_states')
      .select(
        `run_id, reviewer_id, instance_id, field_id, current_decision_id,
         reviewer_decision:current_decision_id (
           decision, value, created_at
         ),
         reviewer:reviewer_id (
           id, full_name, avatar_url
         )`,
      )
      .eq('run_id', runId)
      .neq('reviewer_id', currentReviewerId);
    if (error) {
      throw new APIError(
        `Failed to load other reviewer values: ${error.message}`,
        undefined,
        { error },
      );
    }
    type Row = ReviewerStateRow & {
      reviewer: { id: string; full_name: string | null; avatar_url: string | null } | null;
    };
    const rows = (data ?? []) as unknown as Row[];
    const grouped = new Map<string, OtherUserDecisions>();
    for (const r of rows) {
      if (!r.reviewer_decision) continue;
      const existing = grouped.get(r.reviewer_id);
      const key = `${r.instance_id}_${r.field_id}`;
      const value = unwrapValue(r.reviewer_decision.value);
      const decidedAt = r.reviewer_decision.created_at ?? '';
      if (existing) {
        existing.values[key] = value;
        if (decidedAt > existing.latestDecidedAt) {
          existing.latestDecidedAt = decidedAt;
        }
      } else {
        grouped.set(r.reviewer_id, {
          reviewerId: r.reviewer_id,
          reviewerName: r.reviewer?.full_name ?? 'User',
          reviewerAvatar: r.reviewer?.avatar_url ?? null,
          values: { [key]: value },
          latestDecidedAt: decidedAt,
        });
      }
    }
    return [...grouped.values()];
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
