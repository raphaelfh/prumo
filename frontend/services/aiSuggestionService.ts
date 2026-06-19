/**
 * AI suggestions service — reads AI proposals via the typed API client,
 * persists accept/reject as ReviewerDecisions on the active extraction run.
 *
 * The backend endpoints (/api/v1/articles/{id}/suggestions, /history,
 * /instance-ids) replace the previous direct PostgREST reads from
 * `extraction_proposal_records`, `extraction_evidence`,
 * `extraction_reviewer_states`, and `supabase.auth.getUser()`.
 * Caller-scoped status (accepted/rejected/pending) is now resolved
 * server-side and returned in each AISuggestionItem.
 */
import { apiClient } from '@/integrations/api';
import { ExtractionValueService } from '@/services/extractionValueService';
import type {
  AISuggestion,
  AISuggestionHistoryItem,
  LoadSuggestionsResult,
} from '@/types/ai-extraction';
import { getSuggestionKey } from '@/types/ai-extraction';
import { APIError } from '@/lib/ai-extraction/errors';
import type { components } from '@/types/api/schema';

type AISuggestionItem = components['schemas']['AISuggestionItem'];
type AISuggestionHistoryItemServer = components['schemas']['AISuggestionHistoryItem'];
type AISuggestionsResponse = components['schemas']['AISuggestionsResponse'];

function unwrapValue(raw: { [key: string]: unknown } | null | undefined): unknown {
  if (raw === null || raw === undefined) return '';
  if ('value' in raw) return raw['value'] ?? '';
  return raw;
}

function mapItemToSuggestion(
  item: AISuggestionItem,
  statusOverride?: string,
): AISuggestion {
  return {
    id: item.id,
    runId: item.run_id,
    value: unwrapValue(item.proposed_value as { [key: string]: unknown }),
    confidence: item.confidence_score ?? 0,
    reasoning: item.rationale ?? '',
    status: (statusOverride ?? item.status ?? 'pending') as AISuggestion['status'],
    timestamp: new Date(item.created_at),
    evidence: item.evidence?.text_content
      ? {
          text: item.evidence.text_content,
          pageNumber: item.evidence.page_number ?? null,
        }
      : undefined,
  };
}

function mapHistoryItemToSuggestion(
  item: AISuggestionHistoryItemServer,
): AISuggestionHistoryItem {
  return {
    id: item.id,
    runId: item.run_id,
    value: unwrapValue(item.proposed_value as { [key: string]: unknown }),
    confidence: item.confidence_score ?? 0,
    reasoning: item.rationale ?? '',
    // History items have no server-side status (raw proposal trail)
    status: 'pending',
    timestamp: new Date(item.created_at),
    evidence: item.evidence?.text_content
      ? {
          text: item.evidence.text_content,
          pageNumber: item.evidence.page_number ?? null,
        }
      : undefined,
  };
}

export class AISuggestionService {
  static async loadSuggestions(
    articleId: string,
    instanceIds: string[],
    runId?: string,
  ): Promise<LoadSuggestionsResult> {
    if (instanceIds.length === 0) {
      return { suggestions: {}, count: 0 };
    }

    const params = new URLSearchParams();
    for (const id of instanceIds) {
      params.append('instance_ids', id);
    }
    if (runId) {
      params.append('run_id', runId);
    }

    const response = await apiClient<AISuggestionsResponse>(
      `/api/v1/articles/${articleId}/suggestions?${params.toString()}`,
    );

    const suggestionsMap: Record<string, AISuggestion> = {};
    for (const item of response.suggestions) {
      const key = getSuggestionKey(item.instance_id, item.field_id);
      // First-wins guard: server already dedups to latest-per-coord,
      // but keep this harmless if duplicates slip through.
      if (suggestionsMap[key]) continue;
      suggestionsMap[key] = mapItemToSuggestion(item);
    }

    return {
      suggestions: suggestionsMap,
      count: Object.keys(suggestionsMap).length,
    };
  }

  static async getHistory(
    articleId: string,
    instanceId: string,
    fieldId: string,
    limit = 10,
  ): Promise<AISuggestionHistoryItem[]> {
    const params = new URLSearchParams({
      instance_id: instanceId,
      field_id: fieldId,
      limit: String(limit),
    });

    const items = await apiClient<AISuggestionHistoryItemServer[]>(
      `/api/v1/articles/${articleId}/suggestions/history?${params.toString()}`,
    );

    return items.map(mapHistoryItemToSuggestion);
  }

  /**
   * Accept an AI proposal: post a ReviewerDecision with
   * `decision='accept_proposal'`. The proposal id (which is now the
   * `suggestionId`) is the `proposal_record_id`.
   *
   * Callers should pass ``runId`` — the run the surface is editing.
   * Without it the service falls back to the latest non-terminal
   * extraction-kind run on the article, which can resolve to a stale
   * PENDING/PROPOSAL run when the article carries multiple runs (batch
   * extraction, reopens, contract-test pollution) and silently 400 on
   * the decisions endpoint.
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
    runId?: string;
  }): Promise<void> {
    const { suggestionId, articleId, instanceId, fieldId, runId } = params;
    const targetRunId = runId ?? (await this.resolveActiveRunId(articleId));
    if (!targetRunId) {
      throw new APIError(
        'No active extraction run for this article — cannot accept proposal.',
      );
    }
    await ExtractionValueService.acceptProposal(
      targetRunId,
      instanceId,
      fieldId,
      suggestionId,
    );
  }

  /**
   * Reject an AI proposal: post a ReviewerDecision with
   * `decision='reject'`. The historical proposal stays in
   * `extraction_proposal_records` for audit.
   *
   * Same ``runId`` plumbing rationale as ``acceptSuggestion``.
   */
  static async rejectSuggestion(params: {
    suggestionId: string;
    reviewerId: string;
    wasAccepted?: boolean;
    instanceId?: string;
    fieldId?: string;
    projectId?: string;
    articleId?: string;
    runId?: string;
  }): Promise<void> {
    const { instanceId, fieldId, articleId, runId } = params;
    if (!instanceId || !fieldId || !articleId) return;
    const targetRunId = runId ?? (await this.resolveActiveRunId(articleId));
    if (!targetRunId) return;
    await ExtractionValueService.rejectValue(targetRunId, instanceId, fieldId);
  }

  private static async resolveActiveRunId(
    articleId: string,
  ): Promise<string | null> {
    const run = await ExtractionValueService.findActiveRun(articleId, null);
    return run?.id ?? null;
  }

  static async getArticleInstanceIds(articleId: string): Promise<string[]> {
    return apiClient<string[]>(`/api/v1/articles/${articleId}/instance-ids`);
  }
}
