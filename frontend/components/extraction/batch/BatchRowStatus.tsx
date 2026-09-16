/**
 * Row-level queued/running indicator for an article under an active AI
 * batch (spec 2026-09-15 §11.1).
 */
import {Clock, Loader2} from 'lucide-react';
import type {JSX} from 'react';

import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';

export function BatchRowStatus({
  status,
}: {
  status: 'queued' | 'running' | undefined;
}): JSX.Element | null {
  if (status === undefined) {
    return null;
  }

  const label = status === 'queued' ? t('aiBatch', 'rowQueued') : t('aiBatch', 'rowRunning');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {status === 'queued' ? (
          <Clock className="h-3 w-3 text-muted-foreground" aria-label={label} />
        ) : (
          <Loader2 className="h-3 w-3 animate-spin text-info" aria-label={label} />
        )}
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}
