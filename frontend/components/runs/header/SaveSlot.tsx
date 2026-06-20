import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import type { SaveState } from '@/hooks/runs';

const SAVED_VISIBLE_MS = 2000;
const FADE_MS = 300;

type SavedPhase = 'idle' | 'shown' | 'fading';

/**
 * Subtle, transient save indicator that lives by the title:
 *  - "Saving…" while a write is in flight,
 *  - a brief "✓ Saved" that stays for SAVED_VISIBLE_MS then fades to opacity-0
 *    (kept mounted through the FADE_MS transition so it really fades),
 *  - "Save failed" persists (red) until the next save attempt.
 */
export function SaveSlot({ state, lastSavedAt, hidden }: { state: SaveState; lastSavedAt: Date | null; hidden?: boolean }) {
  const [savedPhase, setSavedPhase] = useState<SavedPhase>('idle');

  // Drive the show → fade → unmount lifecycle when a save lands. Timers cleared
  // in cleanup (React-Compiler-safe — no try/finally).
  useEffect(() => {
    if (state !== 'saved') {
      setSavedPhase('idle');
      return;
    }
    setSavedPhase('shown');
    const fadeAt = setTimeout(() => setSavedPhase('fading'), SAVED_VISIBLE_MS);
    const hideAt = setTimeout(() => setSavedPhase('idle'), SAVED_VISIBLE_MS + FADE_MS);
    return () => {
      clearTimeout(fadeAt);
      clearTimeout(hideAt);
    };
  }, [state, lastSavedAt]);

  if (hidden) return null;
  const failed = state === 'error';
  const saving = state === 'saving';
  const showSaved = !saving && !failed && savedPhase !== 'idle';
  // Nothing to show: idle, or a Saved that has already faded out.
  if (!saving && !failed && !showSaved) return null;

  const label = saving ? t('runs', 'saving') : failed ? t('runs', 'saveFailed') : t('runs', 'saved');
  return (
    <span
      className={cn(
        'flex items-center gap-1 whitespace-nowrap text-[11px] transition-opacity duration-300',
        failed ? 'text-destructive' : 'text-muted-foreground',
        savedPhase === 'fading' ? 'opacity-0' : 'opacity-100',
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
