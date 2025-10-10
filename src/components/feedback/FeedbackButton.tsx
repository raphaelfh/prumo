/**
 * Botão de feedback no Topbar
 * Abre o dialog de feedback ao ser clicado
 */

import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FeedbackDialog } from './FeedbackDialog';

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
              aria-label="Enviar feedback"
              className="flex-shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              <MessageCircle className="h-[18px] w-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Enviar feedback</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <FeedbackDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

