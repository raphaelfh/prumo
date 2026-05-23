/**
 * Status badges row shown in the extraction full-screen header
 * (role · blind mode · progress · save status). Compact / mobile mode
 * groups everything but the role badge into a dropdown.
 *
 * The save indicator is delegated to ``SaveStatusBadge`` so the same
 * state machine renders identically here and in the Quality Assessment
 * header.
 */

import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EyeOff, MoreHorizontal } from 'lucide-react';
import { type UserRole } from '@/lib/comparison/permissions';
import { useIsMobile } from '@/hooks/use-mobile';
import { t } from '@/lib/copy';
import { SaveStatusBadge } from '@/components/runs/SaveStatusBadge';
import type { SaveState } from '@/hooks/runs';

function getRoleCopyKey(
  role: UserRole,
): keyof typeof import('@/lib/copy').common {
  return `role${role.charAt(0).toUpperCase()}${role.slice(1)}` as
    | 'roleManager'
    | 'roleConsensus'
    | 'roleReviewer'
    | 'roleViewer';
}

interface HeaderStatusBadgesProps {
  userRole?: UserRole;
  isBlindMode?: boolean;

  completedFields: number;
  totalFields: number;
  completionPercentage: number;

  saveState?: SaveState;
  lastSavedAt?: Date | null;
  hasUnsavedChanges?: boolean;

  /** Compact mode (groups badges into a dropdown on mobile). */
  compact?: boolean;
}

export function HeaderStatusBadges({
  userRole,
  isBlindMode,
  completedFields,
  totalFields,
  completionPercentage,
  saveState,
  lastSavedAt = null,
  hasUnsavedChanges = false,
  compact = false,
}: HeaderStatusBadgesProps) {
  const isMobile = useIsMobile();
  const shouldGroupBadges = compact || isMobile;

  const roleBadge = userRole ? (
    <Badge
      variant="secondary"
      className="text-xs font-medium px-2 py-0.5 bg-muted/60 text-muted-foreground border-0"
    >
      {t('common', getRoleCopyKey(userRole))}
    </Badge>
  ) : null;

  const blindModeBadge = isBlindMode ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="text-xs px-2 py-0.5 border-border/60 bg-transparent"
        >
          <EyeOff className="h-3 w-3" />
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={5} className="z-[100]">
        {t('extraction', 'headerBlindMode')}
      </TooltipContent>
    </Tooltip>
  ) : null;

  const getProgressColor = () => {
    if (completionPercentage === 100) {
      return 'text-success border-success/40 bg-success/5';
    } else if (completionPercentage >= 50) {
      return 'text-warning border-warning/40 bg-warning/5';
    } else {
      return 'text-muted-foreground border-border/60 bg-transparent';
    }
  };

  const progressBadge = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`text-xs px-2.5 py-0.5 font-medium tabular-nums transition-colors ${getProgressColor()}`}
        >
          {completionPercentage}%
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={5} className="z-[100]">
        {completedFields} {t('extraction', 'headerProgressOf')} {totalFields}{' '}
        {t('extraction', 'headerProgressFields')} ({completionPercentage}%)
      </TooltipContent>
    </Tooltip>
  );

  const saveStatusBadge = saveState ? (
    <SaveStatusBadge
      saveState={saveState}
      lastSavedAt={lastSavedAt}
      hasUnsavedChanges={hasUnsavedChanges}
    />
  ) : null;

  if (!shouldGroupBadges) {
    return (
      <div className="flex items-center gap-3">
        {roleBadge}
        {blindModeBadge}
        {progressBadge}
        {saveStatusBadge}
      </div>
    );
  }

  const badges = [
    roleBadge && { label: t('extraction', 'headerRole'), content: roleBadge },
    blindModeBadge && {
      label: t('extraction', 'headerBlindMode'),
      content: blindModeBadge,
    },
    progressBadge && {
      label: t('extraction', 'headerProgress'),
      content: progressBadge,
    },
    saveStatusBadge && {
      label: t('extraction', 'headerStatus'),
      content: saveStatusBadge,
    },
  ].filter(Boolean) as Array<{ label: string; content: JSX.Element }>;

  if (badges.length === 0) {
    return null;
  }

  if (badges.length <= 2) {
    return (
      <div className="flex items-center gap-2">
        {badges.map((badge, index) => (
          <div key={index}>{badge.content}</div>
        ))}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Badge
              variant="outline"
              className="text-xs cursor-pointer gap-1.5 h-7 px-2.5 border-border/60 bg-transparent hover:bg-muted/50"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Badge>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={5} className="z-[100]">
          {t('extraction', 'headerViewAllStatus')}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56 p-2">
        {badges.map((badge, index) => (
          <div key={index} className="px-2 py-1.5">
            {badge.content}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
