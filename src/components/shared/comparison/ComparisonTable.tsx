/**
 * Tabela genérica de comparação
 * 
 * Componente reutilizável para comparar valores entre múltiplos usuários.
 * Funciona com qualquer tipo de dados através de TypeScript generics.
 * 
 * Features:
 * - Generic <T> para type safety
 * - Colunas configuráveis
 * - Detecção automática de consenso
 * - Highlights visuais de match/divergência
 * - Performance otimizada (useMemo)
 * - Acessibilidade completa
 * 
 * @component
 */

import { useMemo } from 'react';
import { 
  Table, 
  TableHeader, 
  TableBody, 
  TableRow, 
  TableHead, 
  TableCell 
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatComparisonValue } from '@/lib/comparison/formatters';
import { detectConsensus } from '@/lib/comparison/consensus';
import { ConsensusIndicator } from './ConsensusIndicator';
import { ComparisonCell } from './ComparisonCell';

// =================== INTERFACES ===================

/**
 * Definição de coluna para comparação
 */
export interface ComparisonColumn<T = any> {
  id: string;
  label: string;
  getValue: (rowId: string, userData: Record<string, T>) => any;
  isRequired?: boolean;
  width?: string;
  formatValue?: (value: any) => string;
  field?: any; // ✅ NOVO: metadados do campo
}

/**
 * Dados de um usuário na comparação
 */
export interface ComparisonUser {
  userId: string;
  userName: string;
  userAvatar?: string;
  isCurrentUser?: boolean;
}

/**
 * Props do ComparisonTable
 */
export interface ComparisonTableProps<T = any> {
  columns: ComparisonColumn<T>[];
  rows: string[]; // IDs das linhas (ex: fieldIds, instanceIds)
  currentUser: ComparisonUser;
  otherUsers: ComparisonUser[];
  data: Record<string, Record<string, T>>; // userId -> rowId -> value
  showConsensus?: boolean;
  consensusThreshold?: number; // 0-1, default: 0.5
  editable?: boolean; // Permite edição inline para current user
  onValueChange?: (rowId: string, newValue: any) => void; // Callback de edição
  onCellClick?: (rowId: string, userId: string, value: T) => void;
  className?: string;
  maxHeight?: string;
}

// =================== COMPONENT ===================

/**
 * Tabela genérica de comparação entre usuários
 * 
 * Estrutura:
 * - Header sticky com nomes dos usuários
 * - Body scrollable com valores
 * - Coluna de consenso (opcional)
 * - Highlights automáticos
 */
export function ComparisonTable<T = any>({
  columns,
  rows,
  currentUser,
  otherUsers,
  data,
  showConsensus = true,
  consensusThreshold = 0.5,
  editable = false,
  onValueChange,
  onCellClick,
  className,
  maxHeight = '600px'
}: ComparisonTableProps<T>) {
  
  const allUsers = useMemo(() => 
    [currentUser, ...otherUsers], 
    [currentUser, otherUsers]
  );

  // Pre-computar grid data (memoizado para performance)
  const gridData = useMemo(() => {
    return rows.map(rowId => {
      // Coletar valor de cada usuário para esta linha
      const userValues = allUsers.map(user => {
        const userData = data[user.userId] || {};
        // Assumindo que row representa um campo único
        return userData[rowId];
      });

      // Detectar consenso para esta linha
      const consensus = detectConsensus(userValues, consensusThreshold);

      return {
        rowId,
        userValues: allUsers.map((user, idx) => ({
          userId: user.userId,
          value: userValues[idx]
        })),
        consensus
      };
    });
  }, [rows, allUsers, data, consensusThreshold]);

  // Estatísticas gerais
  const stats = useMemo(() => {
    const totalRows = gridData.length;
    let consensusRows = 0;

    gridData.forEach(row => {
      if (row.consensus?.hasConsensus) {
        consensusRows++;
      }
    });

    return {
      total: totalRows,
      consensus: consensusRows,
      divergent: totalRows - consensusRows,
      consensusPercentage: totalRows > 0 
        ? Math.round((consensusRows / totalRows) * 100)
        : 0
    };
  }, [gridData]);

  // Calcular altura dinâmica baseada no número de rows
  const tableHeight = useMemo(() => {
    const headerHeight = 50; // px
    const statsHeight = showConsensus && stats.total > 0 ? 45 : 0; // px
    const rowHeight = 60; // px aproximado por row
    const padding = 20; // px

    const calculatedHeight = headerHeight + statsHeight + (rows.length * rowHeight) + padding;
    const maxHeightPx = parseInt(maxHeight.replace('px', '')); // Parse '600px' → 600

    // Retornar mínimo entre calculado e máximo (para scroll em tabelas grandes)
    return Math.min(calculatedHeight, maxHeightPx);
  }, [rows.length, showConsensus, stats.total, maxHeight]);

  if (rows.length === 0) {
    return (
      <div className="border rounded-lg p-8 text-center text-muted-foreground">
        <p>Nenhum campo para comparar</p>
      </div>
    );
  }

  return (
    <div className={cn("border rounded-lg overflow-hidden", className)}>
      {/* Estatísticas (opcional) */}
      {showConsensus && stats.total > 0 && (
        <div className="bg-muted/30 px-4 py-2 border-b flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">Resumo:</span>
          <Badge variant="secondary" className="gap-1">
            <TrendingUp className="h-3 w-3" />
            {stats.consensus} consenso
          </Badge>
          <Badge variant="outline" className="gap-1">
            <AlertTriangle className="h-3 w-3 text-orange-600" />
            {stats.divergent} divergência
          </Badge>
          <Badge variant="outline" className="ml-auto">
            {stats.consensusPercentage}% concordância
          </Badge>
        </div>
      )}

      <ScrollArea style={{ height: `${tableHeight}px` }}>
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
            <TableRow>
              <TableHead className="w-[200px] font-semibold">Campo</TableHead>
              
              {/* Coluna do usuário atual (destacada) */}
              <TableHead className="w-[150px] bg-blue-50 dark:bg-blue-950/20 font-semibold">
                <div className="flex items-center gap-2">
                  <span>{currentUser.userName}</span>
                  <Badge variant="secondary" className="text-xs">Você</Badge>
                </div>
              </TableHead>

              {/* Colunas de outros usuários */}
              {otherUsers.map(user => (
                <TableHead key={user.userId} className="w-[150px]">
                  {user.userName}
                </TableHead>
              ))}

              {/* Coluna de consenso */}
              {showConsensus && (
                <TableHead className="w-[140px] font-semibold text-center">
                  Consenso
                </TableHead>
              )}
            </TableRow>
          </TableHeader>

          <TableBody>
            {gridData.map(({ rowId, userValues, consensus }) => {
              // Encontrar metadados da linha (do primeiro campo que contém este rowId)
              const rowMetadata = columns.find(c => c.id === rowId);
              const rowLabel = rowMetadata?.label || rowId;
              const isRequired = rowMetadata?.isRequired;

              const myValue = userValues[0]; // Current user sempre primeiro
              const myValueFormatted = formatComparisonValue(myValue.value);

              return (
                <TableRow key={rowId}>
                  {/* Label da linha */}
                  <TableCell className="font-medium">
                    <div className="space-y-1">
                      <div>{rowLabel}</div>
                      {isRequired && (
                        <Badge variant="destructive" className="text-xs">
                          Obrigatório
                        </Badge>
                      )}
                    </div>
                  </TableCell>

                  {/* Valores de cada usuário */}
                  {userValues.map((userValue, idx) => {
                    const isCurrentUser = idx === 0;
                    const userValueFormatted = formatComparisonValue(userValue.value);
                    const matches = userValueFormatted === myValueFormatted;

                      return (
                        <ComparisonCell
                          key={`${rowId}-${userValue.userId}`}
                          value={userValue.value}
                          isCurrentUser={isCurrentUser}
                          matches={matches}
                          consensus={consensus}
                          editable={editable && isCurrentUser}
                          onValueChange={isCurrentUser && onValueChange ? (newValue) => onValueChange(rowId, newValue) : undefined}
                          onClick={onCellClick ? () => onCellClick(rowId, userValue.userId, userValue.value) : undefined}
                          formatValue={rowMetadata?.formatValue}
                          field={rowMetadata?.field} // ✅ NOVO: passar field
                        />
                      );
                  })}

                  {/* Coluna de consenso */}
                  {showConsensus && (
                    <TableCell className="text-center">
                      <ConsensusIndicator 
                        consensus={consensus} 
                        variant="default"
                      />
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}

