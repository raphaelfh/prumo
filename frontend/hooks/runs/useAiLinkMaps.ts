/**
 * The D0 link-map pair every run screen wires into autosave:
 * ``aiLinkByKey`` — layer 1 (the caller's own persisted decision links) plus
 * layer 2 (this session's accept/select/reject events) — and
 * ``persistedAiLinkByKey`` — layer 1 only, the link-side baseline, so a
 * same-value adoption writes once and stays clean across remounts.
 *
 * NEVER derived from ``suggestions[].status``: the server marks any
 * non-reject caller decision 'accepted' (see
 * extraction_suggestion_read_service._resolve_status), which would fabricate
 * AI provenance for manually-typed values.
 */

import { useMemo } from 'react';

import { deriveAiLinkByKey, EMPTY_SESSION_ADOPTION } from '@/lib/runs/aiLink';
import type { ReviewerDecisionResponse } from '@/hooks/runs/types';

export function useAiLinkMaps(p: {
  decisions: readonly ReviewerDecisionResponse[] | undefined;
  currentUserId: string | null | undefined;
  sessionAdoption: Record<string, string | null>;
}): {
  aiLinkByKey: Record<string, string>;
  persistedAiLinkByKey: Record<string, string>;
} {
  const { decisions, currentUserId, sessionAdoption } = p;
  const aiLinkByKey = useMemo(
    () =>
      deriveAiLinkByKey({
        decisions: decisions ?? [],
        currentUserId: currentUserId ?? null,
        sessionAdoption,
      }),
    [decisions, currentUserId, sessionAdoption],
  );
  const persistedAiLinkByKey = useMemo(
    () =>
      deriveAiLinkByKey({
        decisions: decisions ?? [],
        currentUserId: currentUserId ?? null,
        sessionAdoption: EMPTY_SESSION_ADOPTION,
      }),
    [decisions, currentUserId],
  );
  return { aiLinkByKey, persistedAiLinkByKey };
}
