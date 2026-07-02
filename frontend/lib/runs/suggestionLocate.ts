import type { AISuggestion } from '@/types/ai-extraction';
import { isSuggestionPending } from '@/lib/ai-extraction/suggestionUtils';

/**
 * Header "Review N pending suggestions" locate helpers. The suggestion map is
 * keyed `${instanceId}_${fieldId}` (frontend/types/ai-extraction.ts) — both
 * ids are UUIDs (no underscores), so the FIRST underscore splits reliably.
 *
 * Why a DOM-query path instead of `useActiveSection.scrollToSection`: that
 * registry is private to ExtractionFormView, the header handler lives at page
 * level, and QA has no such hook — `[data-section-id]` is the minimal shared
 * mechanism (the extraction side already renders it via `registerSection`;
 * the nav-rail active highlight catches up when its IntersectionObserver
 * fires).
 */
export function firstPendingInstanceId(suggestions: Record<string, AISuggestion>): string | null {
  const entry = Object.entries(suggestions).find(([, s]) => isSuggestionPending(s));
  if (!entry) return null;
  const key = entry[0];
  const sep = key.indexOf('_');
  return sep > 0 ? key.slice(0, sep) : null;
}

/** Scrolls the form panel to a section wrapper carrying data-section-id. */
export function scrollToSectionById(entityTypeId: string): boolean {
  const el = document.querySelector(`[data-section-id="${CSS.escape(entityTypeId)}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}
