import type { AISuggestion } from '@/types/ai-extraction';
import { isSuggestionPending } from '@/lib/ai-extraction/suggestionUtils';

/**
 * Header "Review N pending suggestions" locate helper. The suggestion map is
 * keyed `${instanceId}_${fieldId}` (frontend/types/ai-extraction.ts) — both
 * ids are UUIDs (no underscores), so the FIRST underscore splits reliably.
 *
 * The page maps the instance to its section and reveals it through
 * `SectionNavHandle.revealSection`, which opens the section before scrolling to
 * it: a closed section would hide the suggestion the header just pointed at. On
 * the extraction page, `entrySlotsShowing` first selects the entries holding it.
 */
export function firstPendingInstanceId(suggestions: Record<string, AISuggestion>): string | null {
  const entry = Object.entries(suggestions).find(([, s]) => isSuggestionPending(s));
  if (!entry) return null;
  const key = entry[0];
  const sep = key.indexOf('_');
  return sep > 0 ? key.slice(0, sep) : null;
}
