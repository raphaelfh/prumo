/**
 * Include / Exclude / Maybe, and "Exclude with reason" when the protocol
 * lists reasons. The keyboard goes through the pure `screeningKeyAction`; one
 * window listener applies it.
 */
import {useEffect, useState} from 'react';

import {AppDialog} from '@/components/patterns/AppDialog';
import {Button} from '@/components/ui/button';
import {KbdBadge} from '@/components/ui/kbd-badge';
import {t} from '@/lib/copy';
import {screeningKeyAction} from '@/lib/screening/keymap';
import type {ScreeningDecisionCreate} from '@/services/screeningService';

interface DecisionButtonsProps {
  reasons: string[];
  disabled: boolean;
  onDecide: (body: ScreeningDecisionCreate) => void;
}

export function DecisionButtons({reasons, disabled, onDecide}: DecisionButtonsProps) {
  const [reasonsOpen, setReasonsOpen] = useState(false);

  const pickReason = (reason: string) => {
    setReasonsOpen(false);
    onDecide({decision: 'exclude', exclusion_reason: reason});
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (disabled || event.repeat) return;
      // Another dialog (the PubMed import) owns its own keys.
      if (!reasonsOpen && event.target instanceof Element && event.target.closest('[role="dialog"]')) return;
      const action = screeningKeyAction(event, reasonsOpen);
      if (action === null) return;
      if (action.kind === 'decide') {
        onDecide({decision: action.decision});
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
        <Button size="default" disabled={disabled} onClick={() => onDecide({decision: 'include'})}>
          {t('screening', 'decisionInclude')}
          <KbdBadge keys={['1']} />
        </Button>
        <Button size="default" variant="outline" disabled={disabled} onClick={() => onDecide({decision: 'exclude'})}>
          {t('screening', 'decisionExclude')}
          <KbdBadge keys={['2']} />
        </Button>
        <Button size="default" variant="outline" disabled={disabled} onClick={() => onDecide({decision: 'maybe'})}>
          {t('screening', 'decisionMaybe')}
          <KbdBadge keys={['3']} />
        </Button>
        {reasons.length > 0 && (
          <Button size="default" variant="ghost" disabled={disabled} onClick={() => setReasonsOpen(true)}>
            {t('screening', 'excludeWithReason')}
            <KbdBadge keys={['E']} />
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('screening', 'keyboardHint')}</p>
      <AppDialog
        open={reasonsOpen}
        onOpenChange={setReasonsOpen}
        title={t('screening', 'reasonsTitle')}
        size="sm"
        showFooter={false}
      >
        <ol className="flex flex-col gap-1">
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
