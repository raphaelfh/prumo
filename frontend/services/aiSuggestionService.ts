/**
 * AI suggestions service — reads ProposalRecord, persists accept/reject
 * as ReviewerDecisions on the active extraction run.
 *
 * Post-migration off `ai_suggestions` AND `extracted_values`: the only
 * persistent state is now the HITL workflow tables. Specifically:
 *
 * - Source of truth for proposed values: `extraction_proposal_records`
 *   (filtered by `source='ai'` for the suggestions panel).
 * - "Accepted" status: there's a non-reject ReviewerDecision in the
 *   `reviewer_state` row for that (instance, field) pointing back at the
 *   proposal.
 * - "Rejected" persists as a ReviewerDecision with `decision='reject'`.
 *
 * Evidence (text + page_number) is loaded from `extraction_evidence`
 * rows linked to each proposal via `proposal_record_id`.
 */
import { supabase } from '@/integrations/supabase/client';
import { ExtractionValueService } from '@/services/extractionValueService';
import type {
  AISuggestion,
  AISuggestionHistoryItem,
  LoadSuggestionsResult,
} from '@/types/ai-extraction';
import { getSuggestionKey } from '@/types/ai-extraction';
import { APIError } from '@/lib/ai-extraction/errors';

interface ProposalRow {
  id: string;
  run_id: string;
  instance_id: string;
  field_id: string;
  source: string;
  proposed_value: { value: unknown } | unknown;
  confidence_score: number | null;
  rationale: string | null;
  created_at: string;
}

interface EvidenceRow {
  proposal_record_id: string | null;
  text_content: string | null;
  page_number: number | null;
}

interface ReviewerStateKeyRow {
  instance_id: string;
  field_id: string;
  reviewer_decision: { decision: string } | { decision: string }[] | null;
}

function unwrapValue(raw: ProposalRow['proposed_value']): unknown {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    return (raw as { value: unknown }).value ?? '';
  }
  return raw;
}

function decisionFromState(state: ReviewerStateKeyRow): string | null {
  if (!state.reviewer_decision) return null;
  const dec = Array.isArray(state.reviewer_decision)
    ? state.reviewer_decision[0]
    : state.reviewer_decision;
  return dec?.decision ?? null;
}

function mapProposalToSuggestion(
  row: ProposalRow,
  evidenceByProposalId: Map<string, EvidenceRow>,
  acceptedKeys: Set<string>,
  rejectedKeys: Set<string>,
): AISuggestion {
  const key = getSuggestionKey(row.instance_id, row.field_id);
  const status = acceptedKeys.has(key)
    ? 'accepted'
    : rejectedKeys.has(key)
      ? 'rejected'
      : 'pending';
  const evidence = evidenceByProposalId.get(row.id);
  return {
    id: row.id,
    runId: row.run_id,
    value: unwrapValue(row.proposed_value),
    confidence: row.confidence_score ?? 0,
    reasoning: row.rationale ?? '',
    status,
    timestamp: new Date(row.created_at),
    evidence: evidence?.text_content
      ? {
          text: evidence.text_content,
          pageNumber: evidence.page_number ?? null,
        }
      : undefined,
  };
}

export class AISuggestionService {
  static async loadSuggestions(
    _articleId: string,
    instanceIds: string[],
  ): Promise<LoadSuggestionsResult> {
    if (instanceIds.length === 0) {
      return { suggestions: {}, count: 0 };
    }

    const proposalsRes = await supabase
      .from('extraction_proposal_records')
      .select(
        'id, run_id, instance_id, field_id, source, proposed_value, confidence_score, rationale, created_at',
      )
      .in('instance_id', instanceIds)
      .eq('source', 'ai')
      .order('created_at', { ascending: false });
    if (proposalsRes.error) {
      throw new APIError(
        `Failed to load proposals: ${proposalsRes.error.message}`,
        undefined,
        { error: proposalsRes.error },
      );
    }
    const proposals = (proposalsRes.data ?? []) as ProposalRow[];

    const proposalIds = proposals.map((p) => p.id);
    const evidenceByProposalId = new Map<string, EvidenceRow>();
    if (proposalIds.length > 0) {
      const evidenceRes = await supabase
        .from('extraction_evidence')
        .select('proposal_record_id, text_content, page_number')
        .in('proposal_record_id', proposalIds);
      if (!evidenceRes.error) {
        for (const ev of (evidenceRes.data ?? []) as EvidenceRow[]) {
          if (ev.proposal_record_id) {
            evidenceByProposalId.set(ev.proposal_record_id, ev);
          }
        }
      }
    }

    // Derive accepted/rejected status from the current user's
    // reviewer_state for each (instance, field). We deliberately ignore
    // other users' decisions — each user sees their own status.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const acceptedKeys = new Set<string>();
    const rejectedKeys = new Set<string>();
    if (user) {
      const statesRes = await supabase
        .from('extraction_reviewer_states')
        .select(
          'instance_id, field_id, current_decision_id, reviewer_decision:current_decision_id(decision)',
        )
        .in('instance_id', instanceIds)
        .eq('reviewer_id', user.id);
      if (!statesRes.error) {
        for (const state of (statesRes.data ?? []) as ReviewerStateKeyRow[]) {
          const decision = decisionFromState(state);
          if (!decision) continue;
          const key = getSuggestionKey(state.instance_id, state.field_id);
          if (decision === 'reject') {
            rejectedKeys.add(key);
          } else {
            acceptedKeys.add(key);
          }
        }
      }
    }

    const suggestionsMap: Record<string, AISuggestion> = {};
    for (const row of proposals) {
      const key = getSuggestionKey(row.instance_id, row.field_id);
      if (suggestionsMap[key]) continue;
      suggestionsMap[key] = mapProposalToSuggestion(
        row,
        evidenceByProposalId,
        acceptedKeys,
        rejectedKeys,
      );
    }

    return {
      suggestions: suggestionsMap,
      count: Object.keys(suggestionsMap).length,
    };
  }

  static async getHistory(
    instanceId: string,
    fieldId: string,
    limit = 10,
  ): Promise<AISuggestionHistoryItem[]> {
    const proposalsRes = await supabase
      .from('extraction_proposal_records')
      .select(
        'id, run_id, instance_id, field_id, source, proposed_value, confidence_score, rationale, created_at',
      )
      .eq('instance_id', instanceId)
      .eq('field_id', fieldId)
      .eq('source', 'ai')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (proposalsRes.error) {
      throw new APIError(
        `Failed to load proposal history: ${proposalsRes.error.message}`,
        undefined,
        { error: proposalsRes.error },
      );
    }
    const proposals = (proposalsRes.data ?? []) as ProposalRow[];

    const proposalIds = proposals.map((p) => p.id);
    const evidenceByProposalId = new Map<string, EvidenceRow>();
    if (proposalIds.length > 0) {
      const evidenceRes = await supabase
        .from('extraction_evidence')
        .select('proposal_record_id, text_content, page_number')
        .in('proposal_record_id', proposalIds);
      if (!evidenceRes.error) {
        for (const ev of (evidenceRes.data ?? []) as EvidenceRow[]) {
          if (ev.proposal_record_id) {
            evidenceByProposalId.set(ev.proposal_record_id, ev);
          }
        }
      }
    }

    return proposals.map((row) =>
      mapProposalToSuggestion(
        row,
        evidenceByProposalId,
        /* acceptedKeys */ new Set(),
        /* rejectedKeys */ new Set(),
      ),
    );
  }

  /**
   * Accept an AI proposal: post a ReviewerDecision with
   * `decision='accept_proposal'`. The proposal id (which is now the
   * `suggestionId`) is the `proposal_record_id`.
   */
  static async acceptSuggestion(params: {
    suggestionId: string;
    projectId: string;
    articleId: string;
    instanceId: string;
    fieldId: string;
    value: unknown;
    confidence: number;
    reviewerId: string;
  }): Promise<void> {
    const { suggestionId, articleId, instanceId, fieldId } = params;
    const run = await ExtractionValueService.findActiveRun(articleId, null);
    if (!run) {
      throw new APIError(
        'No active extraction run for this article — cannot accept proposal.',
      );
    }
    await ExtractionValueService.acceptProposal(
      run.id,
      instanceId,
      fieldId,
      suggestionId,
    );
  }

  /**
   * Reject an AI proposal: post a ReviewerDecision with
   * `decision='reject'`. The historical proposal stays in
   * `extraction_proposal_records` for audit.
   */
  static async rejectSuggestion(params: {
    suggestionId: string;
    reviewerId: string;
    wasAccepted?: boolean;
    instanceId?: string;
    fieldId?: string;
    projectId?: string;
    articleId?: string;
  }): Promise<void> {
    const { instanceId, fieldId, articleId } = params;
    if (!instanceId || !fieldId || !articleId) return;
    const run = await ExtractionValueService.findActiveRun(articleId, null);
    if (!run) return;
    await ExtractionValueService.rejectValue(run.id, instanceId, fieldId);
  }

  static async getArticleInstanceIds(articleId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('extraction_instances')
      .select('id')
      .eq('article_id', articleId)
      .not('article_id', 'is', null);
    if (error) {
      throw new APIError(
        `Failed to load instances: ${error.message}`,
        undefined,
        { error },
      );
    }
    return (data ?? []).map((i) => i.id);
  }
}
