import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import type { SaveState } from '@/hooks/runs';

const SAVED_VISIBLE_MS = 2000;
const FADE_MS = 300;

/**
 * Subtle, transient save indicator that lives by the title:
 *  - "Saving…" while a write is in flight,
 *  - a brief "✓ Saved" that stays for SAVED_VISIBLE_MS then fades to opacity-0
 *    (kept mounted through the FADE_MS transition so it really fades),
 *  - "Save failed" persists (red) until the next save attempt.
 */
export function SaveSlot({ state, lastSavedAt, hidden }: { state: SaveState; lastSavedAt: Date | null; hidden?: boolean }) {
  // The "Saved" pill is keyed by the timestamp of the save it represents, so a
  // NEW save restarts the show→fade→gone lifecycle.
  const savedKey = state === 'saved' && lastSavedAt ? lastSavedAt.getTime() : null;
  const [shownKey, setShownKey] = useState<number | null>(null);
  const [phase, setPhase] = useState<'shown' | 'fading' | 'gone'>('gone');

  // Render-phase restart when a new save lands (the adjust-state-on-prop-change
  // pattern — not an effect, so no cascading-render). Guarded by the key
  // comparison so it runs once per new save and then stabilises.
  if (savedKey !== null && savedKey !== shownKey) {
    setShownKey(savedKey);
    setPhase('shown');
  }

  // Timer-only effect: every setState here runs inside a setTimeout callback,
  // never synchronously. Cleared in cleanup (no try/finally — React Compiler).
  useEffect(() => {
    if (shownKey === null) return;
    const fadeAt = setTimeout(() => setPhase('fading'), SAVED_VISIBLE_MS);
    const hideAt = setTimeout(() => setPhase('gone'), SAVED_VISIBLE_MS + FADE_MS);
    return () => {
      clearTimeout(fadeAt);
      clearTimeout(hideAt);
    };
  }, [shownKey]);

  if (hidden) return null;
  const failed = state === 'error';
  const saving = state === 'saving';
  const showSaved = !saving && !failed && savedKey !== null && phase !== 'gone';
  // Nothing to show: idle, or a Saved that has already faded out.
  if (!saving && !failed && !showSaved) return null;

  const label = saving ? t('runs', 'saving') : failed ? t('runs', 'saveFailed') : t('runs', 'saved');
  return (
    <span
      className={cn(
        'flex items-center gap-1 whitespace-nowrap text-[11px] transition-opacity duration-300',
        failed ? 'text-destructive' : 'text-muted-foreground',
        showSaved && phase === 'fading' ? 'opacity-0' : 'opacity-100',
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
