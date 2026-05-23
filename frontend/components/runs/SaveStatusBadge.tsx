/**
 * Renders the current auto-save state with distinct affordances per
 * stage. Consumed by both Data Extraction and Quality Assessment
 * full-screen pages — anywhere ``useAutoSaveProposals`` runs.
 *
 * Five states, five different visuals. Crucially:
 *   - ``dirty`` is a real signal ("your edits are still local"), not
 *     hidden behind a stale "saved at HH:mm" timestamp.
 *   - ``saved`` and ``error`` are visually distinct so a failed save
 *     can't be mistaken for a successful one.
 */

import { format } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { AlertTriangle, Check, CircleDot, Clock, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { t } from '@/lib/copy';
import type { SaveState } from '@/hooks/runs';

export interface SaveStatusBadgeProps {
  saveState: SaveState;
  lastSavedAt: Date | null;
  hasUnsavedChanges?: boolean;
  /** Hide the badge entirely (e.g. read-only run, no session yet). */
  hidden?: boolean;
}

export function SaveStatusBadge({
  saveState,
  lastSavedAt,
  hasUnsavedChanges = false,
  hidden = false,
}: SaveStatusBadgeProps) {
  if (hidden) return null;

  // ``idle`` with no prior save in this session: nothing to show.
  if (saveState === 'idle' && !lastSavedAt && !hasUnsavedChanges) {
    return null;
  }

  if (saveState === 'saving') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="gap-1.5 text-xs px-2 py-0.5 border-border/60 bg-transparent animate-pulse"
            data-testid="save-status-saving"
          >
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={5} className="z-[100]">
          {t('extraction', 'headerSaving')}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (saveState === 'dirty') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="gap-1.5 text-xs px-2 py-0.5 border-warning/40 bg-warning/5 text-warning"
            data-testid="save-status-dirty"
          >
            <CircleDot className="h-3 w-3" />
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={5} className="z-[100]">
          {t('extraction', 'headerUnsavedChanges')}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (saveState === 'error') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="gap-1.5 text-xs px-2 py-0.5 border-destructive/50 bg-destructive/10 text-destructive"
            data-testid="save-status-error"
          >
            <AlertTriangle className="h-3 w-3" />
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={5} className="z-[100]">
          {t('extraction', 'headerSaveFailed')}
        </TooltipContent>
      </Tooltip>
    );
  }

  // ``saved`` (or ``idle`` with a prior save) — show the timestamp.
  if (lastSavedAt) {
    const timeLabel = format(lastSavedAt, 'HH:mm', { locale: enUS });
    const Icon = saveState === 'saved' ? Check : Clock;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="gap-1.5 text-xs px-2 py-0.5 border-border/60 bg-transparent text-muted-foreground hover:text-foreground transition-colors"
            data-testid="save-status-saved"
          >
            <Icon className="h-3 w-3" />
            <span className="tabular-nums">{timeLabel}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={5} className="z-[100]">
          {t('extraction', 'headerSavedAt')} {timeLabel}
        </TooltipContent>
      </Tooltip>
    );
  }

  return null;
}
