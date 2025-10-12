/**
 * Indicador visual de consenso
 * 
 * Badge reutilizável que mostra se há consenso ou divergência
 * entre múltiplos revisores.
 * 
 * @component
 */

import { Badge } from '@/components/ui/badge';
import { TrendingUp, AlertTriangle } from 'lucide-react';
import type { ConsensusResult } from '@/lib/comparison/consensus';

interface ConsensusIndicatorProps {
  consensus: ConsensusResult | null;
  variant?: 'default' | 'compact';
  className?: string;
}

/**
 * Badge que indica consenso ou divergência
 * 
 * Variantes:
 * - default: Mostra valor + contagem (ex: "150 (2/3)")
 * - compact: Apenas percentual (ex: "67%")
 */
export function ConsensusIndicator({ 
  consensus, 
  variant = 'default',
  className
}: ConsensusIndicatorProps) {
  // Sem dados
  if (!consensus) {
    return (
      <Badge variant="outline" className={`text-muted-foreground ${className}`}>
        —
      </Badge>
    );
  }

  // Há consenso (≥ threshold)
  if (consensus.hasConsensus) {
    return (
      <Badge variant="secondary" className={`gap-1 ${className}`}>
        <TrendingUp className="h-3 w-3" />
        {variant === 'default' && (
          <>
            <span className="truncate max-w-[80px]">{consensus.value}</span>
            <span className="text-xs">
              ({consensus.count}/{consensus.total})
            </span>
          </>
        )}
        {variant === 'compact' && (
          <span className="text-xs">{consensus.percentage}%</span>
        )}
      </Badge>
    );
  }

  // Divergência (< threshold)
  return (
    <Badge variant="outline" className={`gap-1 text-orange-600 ${className}`}>
      <AlertTriangle className="h-3 w-3" />
      {variant === 'default' ? 'Divergência' : `${consensus.percentage}%`}
    </Badge>
  );
}

