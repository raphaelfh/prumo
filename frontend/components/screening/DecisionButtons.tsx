/**
 * Include / Exclude / Maybe, and "Exclude with reason" when the protocol
 * lists reasons. At full text there is no Maybe: Exclude (and 2 / E) always
 * opens the reasons, a reason being required; "Report not retrieved" is a
 * ghost button with no key; an optional note rides with every decision. The keyboard goes through the pure `screeningKeyAction`; one
 * window listener applies it, unless another handler took the key or an
 * overlay other than its own reasons dialog is open. The caller keys this
 * component by record, so a record change closes the reasons dialog.
 *
 * `recorded` (a solo record's own decision) draws that button with the
 * recorded-choice ring; choosing it again does nothing, another value
 * re-decides. A recorded exclusion re-decides through the reason list only
 * with a reason other than `recordedReason`.
 */
import {Check} from 'lucide-react';
import {useEffect, useId, useRef, useState} from 'react';

import {AppDialog} from '@/components/patterns/AppDialog';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {KbdBadge} from '@/components/ui/kbd-badge';
import {isDialogOpen} from '@/hooks/useKeyboardShortcuts';
import {t} from '@/lib/copy';
import {screeningKeyAction} from '@/lib/screening/keymap';
import {cn} from '@/lib/utils';
import type {ScreeningDecisionCreate, ScreeningPhase} from '@/services/screeningService';

interface DecisionButtonsProps {
  reasons: string[];
  disabled: boolean;
  onDecide: (body: ScreeningDecisionCreate) => void;
  phase: ScreeningPhase;
  /** The caller's recorded decision on a solo record: drawn with the recorded-choice ring; pressing it again does nothing, another value re-decides. */
  recorded?: ScreeningDecisionCreate['decision'] | null;
  /** The recorded exclusion's reason: picking it again does nothing, another reason re-decides. */
  recordedReason?: string | null;
}

type Decision = ScreeningDecisionCreate['decision'];

const DECISIONS = [
  {decision: 'include', key: '1', label: 'decisionInclude', variant: 'default'},
  {decision: 'exclude', key: '2', label: 'decisionExclude', variant: 'outline'},
  {decision: 'maybe', key: '3', label: 'decisionMaybe', variant: 'outline'},
] as const satisfies readonly {decision: Decision; key: string; label: string; variant: 'default' | 'outline'}[];

export function DecisionButtons({reasons, disabled, onDecide, phase, recorded, recordedReason}: DecisionButtonsProps) {
  const fullText = phase === 'full_text';
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const [note, setNote] = useState('');
  const noteId = useId();
  const reasonsList = useRef<HTMLOListElement>(null);
  const decisions = DECISIONS.filter(({decision}) => !(fullText && decision === 'maybe'));

  const send = (body: ScreeningDecisionCreate) => {
    const rationale = note.trim();
    onDecide(fullText && rationale ? {...body, rationale} : body);
  };

  const decide = (decision: Decision) => {
    if (decision === recorded) return;
    // A full-text exclusion needs a reason: the list opens first.
    if (fullText && decision === 'exclude') {
      if (reasons.length > 0) setReasonsOpen(true);
      return;
    }
    send({decision});
  };

  const pickReason = (reason: string) => {
    setReasonsOpen(false);
    if (recorded === 'exclude' && reason === recordedReason) return;
    send({decision: 'exclude', exclusion_reason: reason});
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (disabled || event.repeat || event.defaultPrevented) return;
      // Another overlay (the PubMed import, a menu, a confirm) owns the keys.
      if (isDialogOpen(reasonsOpen ? reasonsList.current : null)) return;
      const action = screeningKeyAction(event, reasonsOpen, phase);
      if (action === null) return;
      if (action.kind === 'decide') {
        decide(action.decision);
      } else if (action.kind === 'open_reasons') {
        if (reasons.length === 0) return;
        setReasonsOpen(true);
      } else {
        const reason = reasons[action.index];
        if (reason === undefined) return;
        pickReason(reason);
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {decisions.map(({decision, key, label, variant}) => {
          const isRecorded = recorded === decision;
          const filled = !isRecorded && variant === 'default';
          return (
            <Button
              key={decision}
              size="default"
              variant={isRecorded ? 'outline' : variant}
              aria-keyshortcuts={key}
              aria-pressed={recorded ? isRecorded : undefined}
              className={cn(isRecorded && 'bg-success/10 text-success ring-1 ring-success hover:bg-success/10')}
              disabled={disabled}
              onClick={() => decide(decision)}
            >
              {isRecorded && <Check className="h-4 w-4" strokeWidth={1.5} />}
              {t('screening', label)}
              {/* The muted chip vanishes on bg-primary: re-tint it from the button's foreground. */}
              <KbdBadge
                keys={[key]}
                className={cn(filled && 'border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground/80')}
              />
            </Button>
          );
        })}
        {!fullText && reasons.length > 0 && (
          <Button
            size="default"
            variant="ghost"
            aria-keyshortcuts="E"
            disabled={disabled}
            onClick={() => setReasonsOpen(true)}
          >
            {t('screening', 'excludeWithReason')}
            <KbdBadge keys={['E']} />
          </Button>
        )}
        {fullText && (
          <Button
            size="default"
            variant="ghost"
            disabled={disabled || recorded === 'not_retrieved'}
            onClick={() => decide('not_retrieved')}
          >
            {t('screening', 'reportNotRetrieved')}
          </Button>
        )}
      </div>
      {fullText && (
        <div className="flex flex-col gap-1">
          <label htmlFor={noteId} className="text-xs text-muted-foreground">
            {t('screening', 'decisionNoteLabel')}
          </label>
          <Textarea id={noteId} rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {t('screening', fullText ? 'keyboardHintFullText' : 'keyboardHint')}
      </p>
      <AppDialog
        open={reasonsOpen}
        onOpenChange={setReasonsOpen}
        title={t('screening', 'reasonsTitle')}
        size="sm"
        showFooter={false}
      >
        <ol ref={reasonsList} className="flex flex-col gap-1">
          {reasons.map((reason, index) => (
            <li key={reason}>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2"
                disabled={disabled}
                onClick={() => pickReason(reason)}
              >
                {index < 9 && <KbdBadge keys={[String(index + 1)]} />}
                <span className="min-w-0 truncate">{reason}</span>
              </Button>
            </li>
          ))}
        </ol>
      </AppDialog>
    </div>
  );
}
