/**
 * Generic comparison table
 *
 * Reusable component to compare values across multiple users.
 * Works with any data type via TypeScript generics.
 *
 * Features:
 * - Generic <T> for type safety
 * - Configurable columns
 * - Automatic consensus detection
 * - Visual highlights for match/divergence
 * - Optimized performance (useMemo)
 * - Full accessibility
 *
 * @component
 */

import {useMemo} from 'react';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Badge} from '@/components/ui/badge';
import {AlertTriangle, TrendingUp} from 'lucide-react';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';
import {formatComparisonValue} from '@/lib/comparison/formatters';
import {detectConsensus} from '@/lib/comparison/consensus';
import {ConsensusIndicator} from './ConsensusIndicator';
import {ComparisonCell} from './ComparisonCell';

// =================== INTERFACES ===================

/**
 * Column definition for comparison
 */
export interface ComparisonColumn<T = any> {
  id: string;
  label: string;
  getValue: (rowId: string, userData: Record<string, T>) => any;
  isRequired?: boolean;
  width?: string;
  formatValue?: (value: any) => string;
    field?: any; // Field metadata for specialized editing
}

/**
 * User data in the comparison
 */
export interface ComparisonUser {
  userId: string;
  userName: string;
  userAvatar?: string;
  isCurrentUser?: boolean;
}

/**
 * ComparisonTable props
 */
export interface ComparisonTableProps<T = any> {
  columns: ComparisonColumn<T>[];
  rows: string[]; // IDs das linhas (ex: fieldIds, instanceIds)
  currentUser: ComparisonUser;
  otherUsers: ComparisonUser[];
  data: Record<string, Record<string, T>>; // userId -> rowId -> value
  showConsensus?: boolean;
  consensusThreshold?: number; // 0-1, default: 0.5
    editable?: boolean; // Allow inline edit for current user
    onValueChange?: (rowId: string, newValue: any) => void; // Edit callback
  onCellClick?: (rowId: string, userId: string, value: T) => void;
  className?: string;
  maxHeight?: string;
}

// =================== COMPONENT ===================

/**
 * Generic comparison table between users
 *
 * Structure:
 * - Sticky header with user names
 * - Scrollable body with values
 * - Optional consensus column
 * - Automatic highlights
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
        // Collect value from each user for this row
      const userValues = allUsers.map(user => {
        const userData = data[user.userId] || {};
          // Assuming row represents a single field
        return userData[rowId];
      });

        // Detect consensus for this row
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

    // Overall statistics
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

    // Compute dynamic height based on number of rows
  const tableHeight = useMemo(() => {
    const headerHeight = 50; // px
    const statsHeight = showConsensus && stats.total > 0 ? 45 : 0; // px
      const rowHeight = 60; // px approximate per row
    const padding = 20; // px

    const calculatedHeight = headerHeight + statsHeight + (rows.length * rowHeight) + padding;
    const maxHeightPx = parseInt(maxHeight.replace('px', '')); // Parse '600px' → 600

      // Return min of calculated and max (for scroll on large tables)
    return Math.min(calculatedHeight, maxHeightPx);
  }, [rows.length, showConsensus, stats.total, maxHeight]);

  if (rows.length === 0) {
    return (
      <div className="border rounded-lg p-8 text-center text-muted-foreground">
          <p>{t('shared', 'noFieldsToCompare')}</p>
      </div>
    );
  }

  return (
    <div className={cn("border rounded-lg overflow-hidden", className)}>
        {/* Statistics (optional) */}
      {showConsensus && stats.total > 0 && (
        <div className="bg-muted/30 px-4 py-2 border-b flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{t('shared', 'summary')}</span>
          <Badge variant="secondary" className="gap-1">
            <TrendingUp className="h-3 w-3" />
              {stats.consensus} {t('shared', 'consensus')}
          </Badge>
          <Badge variant="outline" className="gap-1">
            <AlertTriangle className="h-3 w-3 text-orange-600" />
              {stats.divergent} {t('shared', 'divergence')}
          </Badge>
          <Badge variant="outline" className="ml-auto">
              {stats.consensusPercentage}% {t('shared', 'agreement')}
          </Badge>
        </div>
      )}

      <ScrollArea style={{ height: `${tableHeight}px` }}>
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
            <TableRow>
                <TableHead className="w-[200px] font-semibold">{t('shared', 'fieldLabel')}</TableHead>

                {/* Current user column (highlighted) */}
              <TableHead className="w-[150px] bg-blue-50 dark:bg-blue-950/20 font-semibold">
                <div className="flex items-center gap-2">
                  <span>{currentUser.userName}</span>
                    <Badge variant="secondary" className="text-xs">{t('shared', 'youLabel')}</Badge>
                </div>
              </TableHead>

                {/* Other users columns */}
              {otherUsers.map(user => (
                <TableHead key={user.userId} className="w-[150px]">
                  {user.userName}
                </TableHead>
              ))}

                {/* Consensus column */}
              {showConsensus && (
                <TableHead className="w-[140px] font-semibold text-center">
                    {t('shared', 'consensusColumn')}
                </TableHead>
              )}
            </TableRow>
          </TableHeader>

          <TableBody>
            {gridData.map(({ rowId, userValues, consensus }) => {
                // Find row metadata (from first column that contains this rowId)
              const rowMetadata = columns.find(c => c.id === rowId);
              const rowLabel = rowMetadata?.label || rowId;
              const isRequired = rowMetadata?.isRequired;

                const myValue = userValues[0]; // Current user is always first
              const myValueFormatted = formatComparisonValue(myValue.value);

              return (
                <TableRow key={rowId}>
                    {/* Row label */}
                  <TableCell className="font-medium">
                    <div className="space-y-1">
                      <div>{rowLabel}</div>
                      {isRequired && (
                        <Badge variant="destructive" className="text-xs">
                            {t('shared', 'required')}
                        </Badge>
                      )}
                    </div>
                  </TableCell>

                    {/* Values per user */}
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
                          field={rowMetadata?.field}
                        />
                      );
                  })}

                    {/* Consensus column */}
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

