/**
 * Feedback button in Topbar — opens feedback dialog on click.
 */

import {useState} from 'react';
import {MessageCircle} from 'lucide-react';
import {HeaderIconButton} from '@/components/layout/HeaderIconButton';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {FeedbackDialog} from './FeedbackDialog';
import {t} from '@/lib/copy';

export function FeedbackButton() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <HeaderIconButton
              onClick={() => setDialogOpen(true)}
              aria-label={t('navigation', 'sendFeedback')}
            >
                <MessageCircle strokeWidth={1.5}/>
            </HeaderIconButton>
          </TooltipTrigger>
          <TooltipContent>
              <p>{t('navigation', 'sendFeedback')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <FeedbackDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

