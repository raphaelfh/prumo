/**
 * Header Status Badges - Assessment Module
 *
 * Sub-componente do header responsável por:
 * - Badge de progresso (X/Y items completados)
 * - Indicador de auto-save (salvando... / última atualização)
 * - Badge de status de completude
 *
 * Baseado em ExtractionHeader/HeaderStatusBadges (DRY + KISS)
 *
 * @component
 */

import {Badge} from '@/components/ui/badge';
import {Tooltip, TooltipContent, TooltipTrigger,} from '@/components/ui/tooltip';
import {CheckCircle, Clock, Loader2} from 'lucide-react';
import {format} from 'date-fns';
import {ptBR} from 'date-fns/locale';

// =================== INTERFACES ===================

export interface HeaderStatusBadgesProps {
  completedItems: number;
  totalItems: number;
  completionPercentage: number;
  isSaving?: boolean;
  lastSaved?: Date | null;
  isComplete: boolean;
}

// =================== COMPONENT ===================

export function HeaderStatusBadges(props: HeaderStatusBadgesProps) {
  const {
    completedItems,
    totalItems,
    completionPercentage,
    isSaving,
    lastSaved,
    isComplete,
  } = props;

  // Determinar cor do badge de progresso
  const progressVariant = isComplete
    ? 'default'
    : completionPercentage > 50
    ? 'secondary'
    : 'outline';

  return (
    <div className="flex items-center gap-2">
      {/* Badge de Progresso */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={progressVariant} className="gap-1.5">
            <CheckCircle className="h-3.5 w-3.5" />
            <span>
              {completedItems}/{totalItems}
            </span>
            <span className="text-muted-foreground">({completionPercentage}%)</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {isComplete
              ? 'Avaliação completa'
              : `${totalItems - completedItems} item(ns) restante(s)`}
          </p>
        </TooltipContent>
      </Tooltip>

      {/* Indicador de Auto-Save */}
      {isSaving && (
        <Badge variant="outline" className="gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          Salvando...
        </Badge>
      )}

      {!isSaving && lastSaved && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="gap-1.5">
              <Clock className="h-3 w-3" />
              Salvo
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              Última atualização:{' '}
              {format(lastSaved, "HH:mm'h'", { locale: ptBR })}
            </p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
