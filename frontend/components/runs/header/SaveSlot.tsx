import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import type { SaveState } from '@/hooks/runs';

const SAVED_VISIBLE_MS = 2000;

/**
 * Subtle, transient save indicator that lives by the title:
 *  - "Saving…" while a write is in flight,
 *  - a brief "✓ Saved" that fades after SAVED_VISIBLE_MS,
 *  - "Save failed" persists (red) until the next save attempt.
 */
export function SaveSlot({ state, lastSavedAt, hidden }: { state: SaveState; lastSavedAt: Date | null; hidden?: boolean }) {
  const [savedVisible, setSavedVisible] = useState(false);

  // Show "Saved" briefly when a save lands, then fade it. Timer cleared in
  // cleanup (React-Compiler-safe — no try/finally).
  useEffect(() => {
    if (state !== 'saved') {
      setSavedVisible(false);
      return;
    }
    setSavedVisible(true);
    const id = setTimeout(() => setSavedVisible(false), SAVED_VISIBLE_MS);
    return () => clearTimeout(id);
  }, [state, lastSavedAt]);

  if (hidden) return null;
  const failed = state === 'error';
  const saving = state === 'saving';
  // Nothing to show: idle, or a Saved that has already faded.
  if (!saving && !failed && !savedVisible) return null;

  const label = saving ? t('runs', 'saving') : failed ? t('runs', 'saveFailed') : t('runs', 'saved');
  return (
    <span
      className={cn(
        'flex items-center gap-1 whitespace-nowrap text-[11px] transition-opacity duration-300',
        failed ? 'text-destructive' : 'text-muted-foreground',
      )}
      title={lastSavedAt ? lastSavedAt.toLocaleTimeString() : undefined}
    >
      {failed ? (
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden="true" />
      ) : saving ? (
        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
      ) : (
        <Check className="h-3 w-3 text-success" aria-hidden="true" />
      )}
      {label}
    </span>
  );
}
