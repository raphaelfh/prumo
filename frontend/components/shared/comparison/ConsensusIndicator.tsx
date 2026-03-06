/**
 * Indicador visual de consenso
 *
 * Reusable badge showing consensus or divergence
 * across multiple reviewers.
 * 
 * @component
 */

import {Badge} from '@/components/ui/badge';
import {AlertTriangle, TrendingUp} from 'lucide-react';
import {t} from '@/lib/copy';
import type {ConsensusResult} from '@/lib/comparison/consensus';

interface ConsensusIndicatorProps {
  consensus: ConsensusResult | null;
  variant?: 'default' | 'compact';
  className?: string;
}

/**
 * Badge indicating consensus or divergence
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

    // There is consensus (≥ threshold)
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

    // Divergence (< threshold)
  return (
    <Badge variant="outline" className={`gap-1 text-orange-600 ${className}`}>
      <AlertTriangle className="h-3 w-3" />
        {variant === 'default' ? t('shared', 'divergence') : `${consensus.percentage}%`}
    </Badge>
  );
}

