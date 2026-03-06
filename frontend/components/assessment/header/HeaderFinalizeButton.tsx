/**
 * Header Finalize Button - Assessment Module
 *
 * Header sub-component responsible for:
 * - Assessment finalize button
 * - Indicador de submitting
 * - Disabled when incomplete or saving
 *
 * Baseado em ExtractionHeader/HeaderFinalizeButton (DRY + KISS)
 *
 * @component
 */

import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger,} from '@/components/ui/tooltip';
import {CheckCircle, Loader2} from 'lucide-react';
import {t} from '@/lib/copy';

// =================== INTERFACES ===================

export interface HeaderFinalizeButtonProps {
  isComplete: boolean;
  isSaving?: boolean;
  submitting?: boolean;
  onFinalize: () => void;
}

// =================== COMPONENT ===================

export function HeaderFinalizeButton(props: HeaderFinalizeButtonProps) {
  const { isComplete, isSaving, submitting, onFinalize } = props;

  const isDisabled = !isComplete || isSaving || submitting;

  const tooltipMessage = !isComplete
      ? t('assessment', 'headerCompleteRequired')
    : isSaving
          ? t('assessment', 'headerWaitSave')
    : submitting
              ? t('assessment', 'headerFinalizing')
              : t('assessment', 'headerFinalizeSubmit');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="default"
          size="sm"
          onClick={onFinalize}
          disabled={isDisabled}
          className="gap-2"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
                {t('assessment', 'headerFinalizing')}
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4" />
                {t('assessment', 'headerCompleteAssessment')}
            </>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltipMessage}</p>
      </TooltipContent>
    </Tooltip>
  );
}
