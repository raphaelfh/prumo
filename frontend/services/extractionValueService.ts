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
   * Load the current value per (instance, field) for the given user
   * within a run.
   *
   * Two layers are read in parallel and merged by precedence:
   * 1. ``extraction_reviewer_states`` (joined to
   *    ``extraction_reviewer_decisions``) — the user's formal review
   *    decisions (latest per coord via the materialized pointer).
   * 2. ``extraction_proposal_records`` (source=human, source_user_id=user)
   *    — the user's autosaved input, the raw layer that always reflects
   *    what they typed.
   *
   * Precedence: reviewer_decision wins where it exists; otherwise the
   * latest human proposal_record fills in. Reject decisions clear the
   * coord (the row stays in the output with ``decision='reject'`` so
   * the consumer can distinguish "explicitly rejected" from "never set").
   *
   * Why fallback matters: ``useAutoSaveProposals`` writes proposals
   * regardless of run stage. When a run advances PROPOSAL→REVIEW (via
   * AI extraction or explicit "Submit for review") before any
   * ``reviewer_decision`` exists for the user's typed values, the form
   * would otherwise render blank — even though the proposal is alive.
   */
  async loadValuesForUser(
    runId: string,
    reviewerId: string,
  ): Promise<DecisionValueRow[]> {
    const [decisionsResult, proposalsResult] = await Promise.all([
      supabase
        .from('extraction_reviewer_states')
        .select(
          `run_id, reviewer_id, instance_id, field_id, current_decision_id,
           reviewer_decision:extraction_reviewer_decisions!fk_extraction_reviewer_states_decision_run_match (
             decision, value, created_at
           )`,
        )
        .eq('run_id', runId)
        .eq('reviewer_id', reviewerId),
      supabase
        .from('extraction_proposal_records')
        .select('instance_id, field_id, proposed_value, created_at')
        .eq('run_id', runId)
        .eq('source', 'human')
        .eq('source_user_id', reviewerId)
        .order('created_at', { ascending: false }),
    ]);

    if (decisionsResult.error) {
      throw new APIError(
        `Failed to load reviewer values: ${decisionsResult.error.message}`,
        undefined,
        { error: decisionsResult.error },
      );
    }
    if (proposalsResult.error) {
      throw new APIError(
        `Failed to load reviewer values: ${proposalsResult.error.message}`,
        undefined,
        { error: proposalsResult.error },
      );
    }

    const merged = new Map<string, DecisionValueRow>();
    const key = (instanceId: string, fieldId: string) => `${instanceId}_${fieldId}`;

    // Layer 1 — human proposals (lowest precedence). Latest-first sort
    // means the first occurrence per (instance, field) is the latest.
    const proposalRows = (proposalsResult.data ?? []) as Array<{
      instance_id: string;
      field_id: string;
      proposed_value: unknown;
      created_at: string | null;
    }>;
    for (const p of proposalRows) {
      const k = key(p.instance_id, p.field_id);
      if (merged.has(k)) continue;
      merged.set(k, {
        instanceId: p.instance_id,
        fieldId: p.field_id,
        value: unwrapValue(p.proposed_value),
        decision: 'human_proposal',
        reviewerId,
        decidedAt: p.created_at ?? '',
      });
    }

    // Layer 2 — reviewer decisions (overrides proposals). Non-null
    // decisions only — null reviewer_decision means the state row exists
    // but no decision is current (cleared / never set).
    const decisionRows = (decisionsResult.data ?? []) as unknown as ReviewerStateRow[];
    for (const r of decisionRows) {
      if (r.reviewer_decision === null) continue;
      merged.set(key(r.instance_id, r.field_id), {
        instanceId: r.instance_id,
        fieldId: r.field_id,
        value: unwrapValue(r.reviewer_decision.value),
        decision: r.reviewer_decision.decision ?? 'edit',
        reviewerId: r.reviewer_id,
        decidedAt: r.reviewer_decision.created_at ?? '',
      });
    }

    return [...merged.values()];
  },

  /**
   * Load values from other reviewers in the same run, grouped by user.
   * Used by the collaboration/consensus UI to show divergence.
   */
  async loadValuesForOthers(
    runId: string,
    currentReviewerId: string,
  ): Promise<OtherUserDecisions[]> {
    // PostgREST embed syntax: ``alias:target_table!fk_name(...)``.
    // The previous ``reviewer:reviewer_id(...)`` form was invalid —
    // PostgREST treats the token before ``(`` as a relation name and
    // there is no ``reviewer_id`` relation, so the whole query 400'd
    // and the comparison panel never rendered other-reviewer values
    // (#50). The FK ``extraction_reviewer_states_reviewer_id_fkey``
    // links to ``public.profiles(id)``.
    // The generated Supabase types omit `extraction_reviewer_states`,
    // so we go through an untyped client view for this query (the
    // shape is enforced manually by the `Row` cast below, and the
    // runtime behaviour is covered by vitest).
    type UntypedSupabase = {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            neq: (col: string, val: string) => Promise<{
              data: unknown;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
    const { data, error } = await (supabase as unknown as UntypedSupabase)
      .from('extraction_reviewer_states')
      .select(
        `run_id, reviewer_id, instance_id, field_id, current_decision_id,
         reviewer_decision:extraction_reviewer_decisions!fk_extraction_reviewer_states_decision_run_match (
           decision, value, created_at
         ),
         reviewer:profiles!extraction_reviewer_states_reviewer_id_fkey (
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
