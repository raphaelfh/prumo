import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import { DiscordanceData } from '@/hooks/assessment/useBlindReview';

interface DiscordanceIndicatorProps {
  discordanceData: DiscordanceData | null;
  className?: string;
}

export const DiscordanceIndicator = ({ 
  discordanceData, 
  className 
}: DiscordanceIndicatorProps) => {
  if (!discordanceData) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <span className="text-xs text-muted-foreground">-</span>
      </div>
    );
  }

  const { discordancePercentage, discordantItems, totalItems } = discordanceData;

  // Sem discordâncias
  if (discordancePercentage === 0) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <CheckCircle className="h-3 w-3 text-green-600" />
        <span className="text-xs text-green-600 font-medium">
          Consenso
        </span>
      </div>
    );
  }

  // Com discordâncias
  const getSeverity = (percentage: number) => {
    if (percentage <= 25) return 'low';
    if (percentage <= 50) return 'medium';
    return 'high';
  };

  const severity = getSeverity(discordancePercentage);
  
  const severityStyles = {
    low: {
      icon: 'text-yellow-600',
      text: 'text-yellow-700',
      bg: 'bg-yellow-50'
    },
    medium: {
      icon: 'text-orange-600',
      text: 'text-orange-700',
      bg: 'bg-orange-50'
    },
    high: {
      icon: 'text-red-600',
      text: 'text-red-700',
      bg: 'bg-red-50'
    }
  };

  const styles = severityStyles[severity];

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <AlertTriangle className={`h-3 w-3 ${styles.icon}`} />
      <Badge 
        variant="outline" 
        className={`text-xs px-1.5 py-0.5 ${styles.bg} ${styles.text} border-current`}
      >
        {discordancePercentage}%
      </Badge>
      <span className="text-xs text-muted-foreground">
        ({discordantItems}/{totalItems})
      </span>
    </div>
  );
};
