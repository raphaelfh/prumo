/**
 * Feedback button in Topbar — opens feedback dialog on click.
 */

import {useState} from 'react';
import {MessageCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
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
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDialogOpen(true)}
              aria-label={t('navigation', 'sendFeedback')}
              className="flex-shrink-0 h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors duration-75"
            >
                <MessageCircle className="h-4 w-4" strokeWidth={1.5}/>
            </Button>
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

