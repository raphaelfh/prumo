/**
 * AI suggestions service — reads AI proposals via the typed API client.
 * Read-only: accept/select/reject persistence happens through the screens'
 * autosave (`writeRunFieldValue` with a D0 AI link), not from here — the old
 * direct accept/reject writers were removed with the dead `acceptStrategy`
 * chain (2026-07-05 verify-then-prune).
 *
 * The backend endpoints (/api/v1/articles/{id}/suggestions, /history,
 * /instance-ids) replaced the former direct PostgREST reads from
 * `extraction_proposal_records`, `extraction_evidence`,
 * `extraction_reviewer_states`, and the auth-user reads.
 * Caller-scoped status (accepted/rejected/pending) is resolved server-side
 * and returned in each AISuggestionItem — note it marks ANY non-reject
 * caller decision 'accepted', so it must never seed AI-link derivation.
 */
import { apiClient } from '@/integrations/api';
import type {
  AISuggestion,
  AISuggestionHistoryItem,
  EvidenceCitation,
  LoadSuggestionsResult,
  PromptComposition,
  RunProvenance,
} from '@/types/ai-extraction';
import { getSuggestionKey } from '@/types/ai-extraction';
import { unwrapValueEnvelope, valueAbsentReason } from '@/lib/extraction/valueSemantics';
import type { components } from '@/types/api/schema';

type AISuggestionItem = components['schemas']['AISuggestionItem'];
type AISuggestionHistoryItemServer = components['schemas']['AISuggestionHistoryItem'];
type AISuggestionsResponse = components['schemas']['AISuggestionsResponse'];

type ServerEvidenceItem = components['schemas']['EvidenceResponse'];

function mapEvidenceList(
  list: ServerEvidenceItem[] | null | undefined,
): EvidenceCitation[] | undefined {
  if (!list || list.length === 0) return undefined;
  const sorted = [...list].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  return sorted.map((e) => ({
    text: e.text_content ?? '',
    pageNumber: e.page_number ?? null,
    blockIds: e.blockIds ?? [],
    attributionLabel: (e.attributionLabel as EvidenceCitation['attributionLabel']) ?? null,
    rank: e.rank ?? 0,
  }));
}

function unwrapValue(raw: { [key: string]: unknown } | null | undefined): unknown {
  if (raw === null || raw === undefined) return '';
  // ADR-0016 Phase 3: preserve a resolved disposition as the full marker
  // envelope so the narrowed `isAbstention` still recognizes it (the quiet
  // no-info strip / no-info card) AND the accept/select path propagates the
  // marker to the form value — consistent with how FieldInput writes it. A real
  // value collapses to its scalar as before.
  const reason = valueAbsentReason(raw);
  if (reason !== null) return { value: null, absent_reason: reason };
  return unwrapValueEnvelope(raw) ?? '';
}

/**
 * Flatten the run-level provenance snapshot (snake_case, with nested
 * `params`/`tokens`) into the camelCase `RunProvenance` the disclosure renders.
 * Unknown top-level keys pass through verbatim so a future backend field shows
 * up as a generic row without a frontend change; the nested `params`/`tokens`
 * containers are dropped (their scalars are promoted to top level).
 */
function mapProvenance(
  raw: { [key: string]: unknown } | null | undefined,
): RunProvenance | undefined {
  if (raw === null || raw === undefined || typeof raw !== 'object') return undefined;
  const {
    params,
    tokens,
    ran_by_user_id,
    ran_by_name,
    prompt_version,
    prompt_text,
    prompt_composition,
    ...rest
  } = raw as Record<string, unknown>;
  const p = (params ?? {}) as Record<string, unknown>;
  const tk = (tokens ?? {}) as Record<string, unknown>;
  const out: RunProvenance = { ...rest };
  const assign = (key: keyof RunProvenance, value: unknown) => {
    if (value !== undefined) out[key] = value;
  };
  assign('ranByUserId', ran_by_user_id);
  // The backend resolves `ran_by_name` from the runner's profile on the history
  // path; map it to camelCase so the disclosure's "Ran by" row picks it up
  // (instead of falling through `...rest` as a raw `ran_by_name` generic row).
  assign('ranByName', ran_by_name);
  assign('promptVersion', prompt_version);
  assign('promptText', prompt_text);
  assign('temperature', p['temperature']);
  assign('outputRetries', p['output_retries']);
  assign('timeoutSeconds', p['timeout_seconds']);
  assign('tokensPrompt', tk['prompt']);
  assign('tokensCompletion', tk['completion']);
  assign('tokensTotal', tk['total']);
  const composition = mapPromptComposition(prompt_composition);
  if (composition !== undefined) out.promptComposition = composition;
  return out;
}

/**
 * Flatten the structured `prompt_composition` snapshot (snake_case, nested
 * `article_ref`) into the camelCase {@link PromptComposition} the dialog renders.
 */
function mapPromptComposition(raw: unknown): PromptComposition | undefined {
  if (raw === null || raw === undefined || typeof raw !== 'object') return undefined;
  const pc = raw as Record<string, unknown>;
  const ar = (pc['article_ref'] ?? {}) as Record<string, unknown>;
  return {
    sectionName: pc['section_name'] as string | undefined,
    systemPrompt: pc['system_prompt'] as string | undefined,
    sectionInstruction: pc['section_instruction'] as string | undefined,
    articleRef: {
      fileId: ar['file_id'] as string | null | undefined,
      fileName: ar['file_name'] as string | null | undefined,
      truncated: ar['truncated'] as boolean | undefined,
      estTokens: ar['est_tokens'] as number | null | undefined,
    },
    fieldsRequested: pc['fields_requested'] as string[] | undefined,
    llmCalls: pc['llm_calls'] as number | undefined,
  };
}

function mapItemToSuggestion(item: AISuggestionItem): AISuggestion {
  return {
    id: item.id,
    runId: item.run_id,
    value: unwrapValue(item.proposed_value as { [key: string]: unknown }),
    confidence: item.confidence_score ?? 0,
    reasoning: item.rationale ?? '',
    status: (item.status ?? 'pending') as AISuggestion['status'],
    timestamp: new Date(item.created_at),
    evidence: mapEvidenceList(item.evidence),
    provenance: mapProvenance(item.provenance as { [key: string]: unknown } | null),
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
    evidence: mapEvidenceList(item.evidence),
    provenance: mapProvenance(item.provenance as { [key: string]: unknown } | null),
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

    const items = response?.suggestions ?? [];
    const suggestionsMap: Record<string, AISuggestion> = {};
    for (const item of items) {
      const key = getSuggestionKey(item.instance_id, item.field_id);
      // First-wins guard: server already dedups to latest-per-coord,
      // but keep this harmless if duplicates slip through.
      if (suggestionsMap[key]) continue;
      suggestionsMap[key] = mapItemToSuggestion(item);
    }

    return {
      suggestions: suggestionsMap,
      count: response?.count ?? Object.keys(suggestionsMap).length,
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

    return (items ?? []).map(mapHistoryItemToSuggestion);
  }

  static async getArticleInstanceIds(articleId: string): Promise<string[]> {
    return (await apiClient<string[]>(`/api/v1/articles/${articleId}/instance-ids`)) ?? [];
  }
}
