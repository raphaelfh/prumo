import type { AISuggestion } from '@/types/ai-extraction';
import { isSuggestionPending } from '@/lib/ai-extraction/suggestionUtils';
import { parseCoordKey } from '@/lib/runs/coord';

/**
 * Header "Review N pending suggestions" locate helper over the `coordKey`-keyed
 * suggestion map.
 *
 * The page maps the instance to its section and reveals it through
 * `SectionNavHandle.revealSection`, which opens the section before scrolling to
 * it: a closed section would hide the suggestion the header just pointed at. On
 * the extraction page, `entrySlotsShowing` first selects the entries holding it.
 */
export function firstPendingInstanceId(suggestions: Record<string, AISuggestion>): string | null {
  const entry = Object.entries(suggestions).find(([, s]) => isSuggestionPending(s));
  if (!entry) return null;
  return parseCoordKey(entry[0]).instanceId || null;
}
