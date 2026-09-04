/**
 * Fire the mapped toast for a classified extraction failure; `false` when the
 * code has no specific copy, so the calling hook shows its own generic toast.
 *
 * Hooks own toasts (`.claude/rules/frontend.md`): the pure mapping lives in
 * `lib/ai-extraction/extractionErrorToast`, this is its one hook-side seam,
 * shared by the job hooks and the sync models kickoff so title and duration
 * never drift per hook.
 */
import {toast} from 'sonner';

import {extractionErrorToast} from '@/lib/ai-extraction/extractionErrorToast';

export function showExtractionErrorToast(code: string | null | undefined, message: string): boolean {
  const specific = extractionErrorToast(code, message);
  if (!specific) {
    return false;
  }
  toast.error(specific.title, {description: specific.description, duration: specific.duration});
  return true;
}
