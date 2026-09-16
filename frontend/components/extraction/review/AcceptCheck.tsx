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
 */
export function AcceptCheck({accepted, saving, pending, acceptedElsewhere, onToggle}: AcceptCheckProps) {
  return <IconButton
    icon={<Check/>}
    label={t('extraction', accepted ? 'reviewUnacceptExtraction' : 'reviewAcceptExtraction')}
    hint={!accepted && acceptedElsewhere ? t('extraction', 'reviewAcceptedEarlier') : undefined}
    aria-pressed={accepted}
    aria-disabled={saving || undefined}
    aria-busy={pending || undefined}
    onClick={() => {if (!saving) onToggle();}}
    className={cn(
      'rounded-full',
      accepted && 'bg-success/10 text-success shadow-sm hover:text-success',
      !accepted && acceptedElsewhere && 'text-success ring-1 ring-success/40 hover:text-success',
      pending && 'animate-pulse ring-1 ring-success/60 motion-reduce:animate-none',
      saving && 'cursor-wait',
    )}
  />;
}
