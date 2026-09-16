import {Check} from 'lucide-react';
import {IconButton} from '@/components/patterns/IconButton';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

interface AcceptCheckProps {
  /** THIS version is the reviewer's accepted one. */
  accepted: boolean;
  /** Any decision or save is in flight: the check ignores clicks but is never swapped to `disabled`. */
  saving?: boolean;
  /** This proposal is the in-flight decision. */
  pending?: boolean;
  /** A DIFFERENT version of this coordinate is the accepted one. */
  acceptedElsewhere?: boolean;
  onToggle: () => void;
}

/**
 * The review table's one accept control — shared by the collapsed row preview
 * and every expanded version card so the three states can't drift apart:
 *
 * · accepted — filled success chip, `aria-pressed`; clicking reverses it.
 * · acceptedElsewhere — a success RING, no fill: a decision exists on this
 *   coordinate but on another version. Without it a row whose accepted version
 *   is an older one looked identical to a row nobody has decided yet.
 * · saving — `aria-busy`, and `cursor-wait` because the global
 *   `[aria-disabled="true"] {cursor: not-allowed}` rule (index.css) would
 *   otherwise render in-flight work as forbidden. `aria-disabled` stays: the
 *   click really is ignored, and telling assistive tech otherwise would lie.
 *
 * The click renders OPTIMISTICALLY. `toggle` has exactly two outcomes — it
 * accepts this version, or (when this version is already the accepted one and
 * the head still matches) reverses it — so the click's result is known before
 * the server answers and the check flips at once. The decision itself is one
 * POST, but it queues behind any in-flight autosave batch for the run
 * (`saveNow` awaits `activeSavePromiseRef`), which is what made a click look
 * dead for ~2s. Waiting was never the honest signal: a toggle whose outcome is
 * this predictable should feel like a checkbox.
 *
 * Nothing is fabricated by this. The displayed state is DERIVED from
 * `pending`, so a failed decision needs no rollback — `pending` clears, the
 * check snaps back to the authoritative `accepted`, and the reviewer sees the
 * error alert `ReviewQuickActions` already renders from `decisions.error`.
 * (This supersedes #925's "shows no acceptance until confirmed", whose pulse
 * also contradicted that same PR's "no control remounts or blinks" goal.)
 */
export function AcceptCheck({accepted, saving, pending, acceptedElsewhere, onToggle}: AcceptCheckProps) {
  const shows = pending ? !accepted : accepted;
  // While this version's own acceptance is in flight, the coordinate's decision
  // is moving HERE; pointing at an earlier version mid-flight would contradict
  // the check right next to it.
  const elsewhere = pending ? false : acceptedElsewhere;
  return <IconButton
    icon={<Check/>}
    label={t('extraction', shows ? 'reviewUnacceptExtraction' : 'reviewAcceptExtraction')}
    hint={!shows && elsewhere ? t('extraction', 'reviewAcceptedEarlier') : undefined}
    aria-pressed={shows}
    aria-disabled={saving || undefined}
    aria-busy={pending || undefined}
    onClick={() => {if (!saving) onToggle();}}
    className={cn(
      'rounded-full',
      shows && 'bg-success/10 text-success shadow-sm hover:text-success',
      !shows && elsewhere && 'text-success ring-1 ring-success/40 hover:text-success',
      saving && 'cursor-wait',
    )}
  />;
}
