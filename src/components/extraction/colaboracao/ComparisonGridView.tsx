/**
 * Grid de Comparação de Extrações
 * 
 * Tabela que mostra valores de todos os membros lado a lado.
 * Usado no modo "Comparação" para resolver divergências.
 * 
 * @component
 */

import { useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, AlertTriangle, TrendingUp, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ExtractionField } from '@/types/extraction';
import type { OtherExtraction } from '@/hooks/extraction/colaboracao/useOtherExtractions';

// =================== INTERFACES ===================

interface ComparisonGridViewProps {
  fields: ExtractionField[];
  instanceId: string;
  myValues: Record<string, any>; // key: fieldId
  otherExtractions: OtherExtraction[];
}

// =================== HELPER ===================

function formatValue(value: any): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function detectConsensus(values: any[]) {
  const nonEmpty = values.filter(v => v !== null && v !== undefined && v !== '');
  if (nonEmpty.length === 0) return null;

  const counts: Record<string, number> = {};
  nonEmpty.forEach(v => {
    const str = formatValue(v);
    counts[str] = (counts[str] || 0) + 1;
  });

  let maxCount = 0;
  let consensusValue = null;
  Object.entries(counts).forEach(([val, count]) => {
    if (count > maxCount) {
      maxCount = count;
      consensusValue = val;
    }
  });

  return {
    value: consensusValue,
    count: maxCount,
    total: nonEmpty.length,
    hasConsensus: maxCount > 1 && maxCount >= nonEmpty.length / 2
  };
}

// =================== COMPONENT ===================

export function ComparisonGridView(props: ComparisonGridViewProps) {
  const { fields, instanceId, myValues, otherExtractions } = props;

  const gridData = useMemo(() => {
    return fields.map(field => {
      const myValue = myValues[field.id];
      const otherValues = otherExtractions.map(ext => ({
        userId: ext.userId,
        userName: ext.userName,
        value: ext.values[`${instanceId}_${field.id}`]
      }));

      const allValues = [myValue, ...otherValues.map(ov => ov.value)];
      const consensus = detectConsensus(allValues);

      return {
        field,
        myValue,
        otherValues,
        consensus
      };
    });
  }, [fields, instanceId, myValues, otherExtractions]);

  return (
    <div className="border rounded-lg overflow-hidden">
      <ScrollArea className="h-[600px]">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
            <TableRow>
              <TableHead className="w-[200px] font-semibold">Campo</TableHead>
              <TableHead className="w-[150px] bg-blue-50 dark:bg-blue-950/20 font-semibold">
                Você
              </TableHead>
              {otherExtractions.map(user => (
                <TableHead key={user.userId} className="w-[150px]">
                  {user.userName}
                </TableHead>
              ))}
              <TableHead className="w-[120px] font-semibold">Consenso</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {gridData.map(({ field, myValue, otherValues, consensus }) => {
              const myValueStr = formatValue(myValue);

              return (
                <TableRow key={field.id}>
                  <TableCell className="font-medium">
                    <div className="space-y-1">
                      <div>{field.label}</div>
                      {field.is_required && (
                        <Badge variant="destructive" className="text-xs">
                          Obrigatório
                        </Badge>
                      )}
                    </div>
                  </TableCell>

                  <TableCell className="bg-blue-50/50 dark:bg-blue-950/10">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{myValueStr}</span>
                      {consensus?.value === myValueStr && consensus.count > 1 && (
                        <Check className="h-4 w-4 text-green-600" />
                      )}
                    </div>
                  </TableCell>

                  {otherValues.map(({ userId, userName, value }) => {
                    const valueStr = formatValue(value);
                    const matches = valueStr === myValueStr;

                    return (
                      <TableCell
                        key={userId}
                        className={cn(
                          matches && "bg-green-50 dark:bg-green-950/20"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{valueStr}</span>
                          {matches && (
                            <Check className="h-4 w-4 text-green-600" />
                          )}
                        </div>
                      </TableCell>
                    );
                  })}

                  <TableCell>
                    {consensus && consensus.hasConsensus ? (
                      <Badge variant="secondary" className="gap-1">
                        <TrendingUp className="h-3 w-3" />
                        {consensus.value}
                        <span className="text-xs ml-1">
                          ({consensus.count}/{consensus.total})
                        </span>
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-orange-600">
                        <AlertTriangle className="h-3 w-3" />
                        Divergência
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}

