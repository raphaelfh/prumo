/**
 * Sidebar-footer bug button — opens the feedback dialog. Sits next to the
 * user menu and composes HeaderIconButton, so it stays identical to every
 * other chrome icon button in size, hover, and focus.
 *
 * The dialog is mounted lazily: it pulls auth + mutation hooks, and the
 * footer renders on every project page.
 */

import {useState} from 'react';
import {Bug} from 'lucide-react';
import {HeaderIconButton} from '@/components/layout/HeaderIconButton';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {FeedbackDialog} from './FeedbackDialog';
import {t} from '@/lib/copy';

export function FeedbackButton() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <HeaderIconButton
            onClick={() => setDialogOpen(true)}
            aria-label={t('navigation', 'sendFeedback')}
          >
            <Bug strokeWidth={1.5} aria-hidden="true" />
          </HeaderIconButton>
        </TooltipTrigger>
        <TooltipContent>{t('navigation', 'sendFeedback')}</TooltipContent>
      </Tooltip>

      {dialogOpen && <FeedbackDialog open onOpenChange={setDialogOpen} />}
    </>
  );
}
