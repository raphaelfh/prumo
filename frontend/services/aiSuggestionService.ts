/**
 * AI suggestions service — reads ProposalRecord, derives status from
 * ExtractedValue presence.
 *
 * Post-migration 0019: no more `ai_suggestions` table. The shape returned
 * here still matches the legacy `AISuggestion` so the existing extraction
 * UI keeps working without component-level changes.
 *
 * - Source of truth for proposed values: `extraction_proposal_records`
 *   (filtered by `source='ai'` for the suggestions panel).
 * - "Accepted" status: derived from a matching `extracted_values` row
 *   (instance_id, field_id, reviewer_id) — i.e. the user has saved a
 *   value for that field.
 * - "Rejected" status: not persisted across reloads. The hook tracks it
 *   in local state for the duration of the session.
 *
 * Evidence (text + page_number) is loaded from `extraction_evidence`
 * rows linked to each proposal via `proposal_record_id`.
 */

import { supabase } from '@/integrations/supabase/client';
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

interface ExtractedValueKeyRow {
  instance_id: string;
  field_id: string;
}

function unwrapValue(raw: ProposalRow['proposed_value']): unknown {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    return (raw as { value: unknown }).value ?? '';
  }
  return raw;
}

function mapProposalToSuggestion(
  row: ProposalRow,
  evidenceByProposalId: Map<string, EvidenceRow>,
  acceptedKeys: Set<string>,
): AISuggestion {
  const accepted = acceptedKeys.has(getSuggestionKey(row.instance_id, row.field_id));
  const evidence = evidenceByProposalId.get(row.id);
  return {
    id: row.id,
    runId: row.run_id,
    value: unwrapValue(row.proposed_value),
    confidence: row.confidence_score ?? 0,
    reasoning: row.rationale ?? '',
    status: accepted ? 'accepted' : 'pending',
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
  /**
   * Loads AI proposals for an article's instances and derives their
   * accepted/pending status from `extracted_values`.
   *
   * @param _articleId reserved for future filtering — currently unused
   *                   because instance ids already scope the query.
   */
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

    const acceptedKeys = new Set<string>();
    const acceptedRes = await supabase
      .from('extracted_values')
      .select('instance_id, field_id')
      .in('instance_id', instanceIds);
    if (!acceptedRes.error) {
      for (const row of (acceptedRes.data ?? []) as ExtractedValueKeyRow[]) {
        acceptedKeys.add(getSuggestionKey(row.instance_id, row.field_id));
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

    const acceptedKeys = new Set<string>([getSuggestionKey(instanceId, fieldId)]);
    const acceptedRes = await supabase
      .from('extracted_values')
      .select('instance_id, field_id')
      .eq('instance_id', instanceId)
      .eq('field_id', fieldId)
      .maybeSingle();
    // History is informational; status derivation matters less here
    // because the user is browsing past proposals, but we keep the same
    // mapping for shape parity.
    if (acceptedRes.error || !acceptedRes.data) {
      acceptedKeys.delete(getSuggestionKey(instanceId, fieldId));
    }

    return proposals.map((row) =>
      mapProposalToSuggestion(row, evidenceByProposalId, acceptedKeys),
    );
  }

  /**
   * Accept a proposal: write the value to `extracted_values`. The
   * proposal record itself is append-only and stays as-is; "accepted"
   * is derived from the existence of this row.
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
    const {
      projectId,
      articleId,
      instanceId,
      fieldId,
      value,
      confidence,
      reviewerId,
    } = params;

    const { data: existing, error: selectError } = await supabase
      .from('extracted_values')
      .select('id')
      .eq('instance_id', instanceId)
      .eq('field_id', fieldId)
      .eq('reviewer_id', reviewerId)
      .maybeSingle();
    if (selectError) {
      throw new APIError(
        `Failed to check existing extracted value: ${selectError.message}`,
        undefined,
        { selectError },
      );
    }

    const valueData = {
      project_id: projectId,
      article_id: articleId,
      instance_id: instanceId,
      field_id: fieldId,
      value: { value },
      source: 'ai' as const,
      confidence_score: confidence,
      reviewer_id: reviewerId,
      is_consensus: false,
    };

    if (existing) {
      const { error: updateError } = await supabase
        .from('extracted_values')
        .update(valueData)
        .eq('id', existing.id);
      if (updateError) {
        throw new APIError(
          `Failed to update extracted value: ${updateError.message}`,
          undefined,
          { updateError },
        );
      }
    } else {
      const { error: insertError } = await supabase
        .from('extracted_values')
        .insert(valueData);
      if (insertError) {
        throw new APIError(
          `Failed to create extracted value: ${insertError.message}`,
          undefined,
          { insertError },
        );
      }
    }
  }

  /**
   * Reject a proposal: if a value was previously written for this
   * (instance, field, reviewer), delete it. Rejected state itself is
   * not persisted — the hook's local state shows the rejected UI for
   * the rest of the session.
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
    const { reviewerId, wasAccepted, instanceId, fieldId, articleId } = params;

    if (wasAccepted && instanceId && fieldId && articleId) {
      const { error: deleteError } = await supabase
        .from('extracted_values')
        .delete()
        .eq('instance_id', instanceId)
        .eq('field_id', fieldId)
        .eq('reviewer_id', reviewerId)
        .eq('article_id', articleId);
      if (deleteError) {
        console.warn(
          `Error removing extracted_value on reject: ${deleteError.message}`,
        );
      }
    }
  }

  /**
   * Fetch instance ids for an article. Used to scope subsequent
   * proposal/extracted_values queries.
   */
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
