/**
 * Popover com lista de outras extrações
 * 
 * Mostra valores extraídos por outros membros para um campo específico.
 * Inclui detecção de consenso e link para comparação completa.
 * 
 * @component
 */

import { useMemo } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Users, Check, TrendingUp, Table } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { OtherExtraction } from '@/hooks/extraction/colaboracao/useOtherExtractions';

// =================== INTERFACES ===================

interface OtherExtractionsPopoverProps {
  fieldId: string;
  instanceId: string;
  extractions: OtherExtraction[];
  myValue: any;
  onViewComparison?: () => void;
  children: React.ReactNode;
}

// =================== HELPER ===================

function formatValue(value: any): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// =================== COMPONENT ===================

export function OtherExtractionsPopover(props: OtherExtractionsPopoverProps) {
  const { fieldId, instanceId, extractions, myValue, onViewComparison, children } = props;

  // Filtrar extrações que têm valor para este campo/instância
  const relevantExtractions = useMemo(() => {
    const key = `${instanceId}_${fieldId}`;
    return extractions
      .map(ext => ({
        ...ext,
        value: ext.values[key]
      }))
      .filter(ext => ext.value !== null && ext.value !== undefined);
  }, [extractions, fieldId, instanceId]);

  // Detectar consenso
  const consensus = useMemo(() => {
    if (relevantExtractions.length === 0) return null;

    // Agrupar por valor
    const valueCounts: Record<string, number> = {};
    relevantExtractions.forEach(ext => {
      const valueStr = formatValue(ext.value);
      valueCounts[valueStr] = (valueCounts[valueStr] || 0) + 1;
    });

    // Adicionar meu valor se existir
    const myValueStr = formatValue(myValue);
    if (myValue !== null && myValue !== undefined && myValue !== '') {
      valueCounts[myValueStr] = (valueCounts[myValueStr] || 0) + 1;
    }

    // Encontrar valor mais comum
    let maxCount = 0;
    let consensusValue = null;

    Object.entries(valueCounts).forEach(([value, count]) => {
      if (count > maxCount) {
        maxCount = count;
        consensusValue = value;
      }
    });

    const total = relevantExtractions.length + (myValue ? 1 : 0);

    return {
      value: consensusValue,
      count: maxCount,
      total,
      hasConsensus: maxCount > 1 && maxCount >= total / 2
    };
  }, [relevantExtractions, myValue]);

  if (relevantExtractions.length === 0) return <>{children}</>;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>

      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h4 className="font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Outras Extrações ({relevantExtractions.length})
            </h4>
          </div>

          <Separator />

          {/* Lista de extrações */}
          <ScrollArea className="max-h-[300px] pr-4">
            <div className="space-y-3">
              {relevantExtractions.map((ext) => {
                const valueStr = formatValue(ext.value);
                const myValueStr = formatValue(myValue);
                const matchesMe = valueStr === myValueStr;
                const isConsensusValue = consensus?.value === valueStr;

                return (
                  <div
                    key={ext.userId}
                    className={cn(
                      "p-3 rounded-lg border",
                      matchesMe && "bg-green-50 dark:bg-green-950/20 border-green-200",
                      !matchesMe && isConsensusValue && "bg-blue-50 dark:bg-blue-950/20"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarImage src={ext.userAvatar} />
                        <AvatarFallback>
                          {ext.userName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm">{ext.userName}</p>
                          {matchesMe && (
                            <Badge variant="secondary" className="text-xs">
                              <Check className="h-3 w-3 mr-1" />
                              Igual
                            </Badge>
                          )}
                        </div>

                        <p className="text-sm font-mono mt-1 break-words">
                          {valueStr}
                        </p>

                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(ext.timestamp, {
                            locale: ptBR,
                            addSuffix: true
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {/* Consenso summary */}
          {consensus && consensus.hasConsensus && (
            <>
              <Separator />
              <div className="bg-blue-50 dark:bg-blue-950/20 p-3 rounded-lg">
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <TrendingUp className="h-4 w-4 text-blue-600 shrink-0" />
                  <span className="font-medium">Consenso:</span>
                  <span className="font-mono break-words">{consensus.value}</span>
                  <Badge variant="secondary" className="text-xs">
                    {consensus.count}/{consensus.total}
                  </Badge>
                </div>
              </div>
            </>
          )}

          {/* Link para comparação completa */}
          {onViewComparison && (
            <>
              <Separator />
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={onViewComparison}
              >
                <Table className="mr-2 h-4 w-4" />
                Ver Comparação Completa
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

