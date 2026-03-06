/**
 * Componente de badges de status (Role, Blind Mode, Progresso, Save Status)
 * Responsivo com agrupamento em mobile
 */

import {Badge} from '@/components/ui/badge';
import {Tooltip, TooltipContent, TooltipTrigger,} from '@/components/ui/tooltip';
import {DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,} from '@/components/ui/dropdown-menu';
import {Clock, EyeOff, Loader2, MoreHorizontal} from 'lucide-react';
import {format} from 'date-fns';
import {enUS} from 'date-fns/locale';
import {type UserRole} from '@/lib/comparison/permissions';
import {useIsMobile} from '@/hooks/use-mobile';
import {t} from '@/lib/copy';

function getRoleCopyKey(role: UserRole): keyof typeof import('@/lib/copy').common {
    return (`role${role.charAt(0).toUpperCase()}${role.slice(1)}` as 'roleManager' | 'roleConsensus' | 'roleReviewer' | 'roleViewer');
}

interface HeaderStatusBadgesProps {
  // Permissões
  userRole?: UserRole;
  isBlindMode?: boolean;
  
  // Progresso
  completedFields: number;
  totalFields: number;
  completionPercentage: number;
  
  // Save status
  isSaving?: boolean;
  lastSaved?: Date | null;
  
  /** Modo compacto (agrupa badges em dropdown em mobile) */
  compact?: boolean;
}

export function HeaderStatusBadges({
  userRole,
  isBlindMode,
  completedFields,
  totalFields,
  completionPercentage,
  isSaving = false,
  lastSaved = null,
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

  // Badge de Blind Mode - minimalista
  const blindModeBadge = isBlindMode ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="text-xs px-2 py-0.5 border-border/60 bg-transparent">
          <EyeOff className="h-3 w-3" />
        </Badge>
      </TooltipTrigger>
        <TooltipContent side="top" sideOffset={5}
                        className="z-[100]">{t('extraction', 'headerBlindMode')}</TooltipContent>
    </Tooltip>
  ) : null;

  // Badge de Progresso - minimalista com cores semânticas
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
          {completedFields} {t('extraction', 'headerProgressOf')} {totalFields} {t('extraction', 'headerProgressFields')} ({completionPercentage}%)
      </TooltipContent>
    </Tooltip>
  );

  // Badge de Save Status - minimalista com animações sutis
  const saveStatusBadge = isSaving ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge 
          variant="outline" 
          className="gap-1.5 text-xs px-2 py-0.5 border-border/60 bg-transparent animate-pulse"
        >
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
        </Badge>
      </TooltipTrigger>
        <TooltipContent side="top" sideOffset={5} className="z-[100]">{t('extraction', 'headerSaving')}</TooltipContent>
    </Tooltip>
  ) : lastSaved ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge 
          variant="outline" 
          className="gap-1.5 text-xs px-2 py-0.5 border-border/60 bg-transparent text-muted-foreground hover:text-foreground transition-colors"
        >
          <Clock className="h-3 w-3" />
            <span className="tabular-nums">{format(lastSaved, 'HH:mm', {locale: enUS})}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={5} className="z-[100]">
          {t('extraction', 'headerSavedAt')} {format(lastSaved, 'HH:mm', {locale: enUS})}
      </TooltipContent>
    </Tooltip>
  ) : null;

  // Se não deve agrupar, renderizar todos inline
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

  // Agrupar badges em dropdown para mobile
  const badges = [
      roleBadge && {label: t('extraction', 'headerRole'), content: roleBadge},
      blindModeBadge && {label: t('extraction', 'headerBlindMode'), content: blindModeBadge},
      progressBadge && {label: t('extraction', 'headerProgress'), content: progressBadge},
      saveStatusBadge && {label: t('extraction', 'headerStatus'), content: saveStatusBadge},
  ].filter(Boolean) as Array<{ label: string; content: JSX.Element }>;

  // Se não há badges, não renderizar nada
  if (badges.length === 0) {
    return null;
  }

  // Se há apenas 1-2 badges, mostrar inline em vez de dropdown
  if (badges.length <= 2) {
    return (
      <div className="flex items-center gap-2">
        {badges.map((badge, index) => (
          <div key={index}>{badge.content}</div>
        ))}
      </div>
    );
  }

  // Agrupar 3+ badges em dropdown (apenas em mobile/compact)
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
          <TooltipContent side="top" sideOffset={5}
                          className="z-[100]">{t('extraction', 'headerViewAllStatus')}</TooltipContent>
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

