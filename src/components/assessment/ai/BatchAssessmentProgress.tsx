/**
 * Floating Progress Display para Batch Assessment
 *
 * Mostra progresso da avaliação em lote no canto inferior direito.
 * Adaptado de extraction/FullAIExtractionProgress.tsx (simplificado)
 *
 * @component
 */

import { useState } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2, Sparkles, X, Minimize2, Maximize2 } from 'lucide-react';
import type { BatchAssessmentProgress as BatchProgress } from '@/hooks/assessment/ai/useBatchAssessment';

interface BatchAssessmentProgressProps {
  progress: BatchProgress;
  onClose?: () => void;
}

export function BatchAssessmentProgress({
  progress,
  onClose,
}: BatchAssessmentProgressProps) {
  const [minimized, setMinimized] = useState(false);

  const percent =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  if (minimized) {
    return (
      <Card className="fixed bottom-6 right-6 z-[9999] w-64 shadow-lg border-blue-200">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <span>Avaliando... {percent}%</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => setMinimized(false)}
            >
              <Maximize2 className="h-3 w-3" />
            </Button>
            {onClose && (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={onClose}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="fixed bottom-6 right-6 z-[9999] w-96 shadow-lg border-blue-200">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-600" />
            <h4 className="font-semibold text-sm text-slate-900">
              Avaliando qualidade com IA
            </h4>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => setMinimized(true)}
            >
              <Minimize2 className="h-3 w-3" />
            </Button>
            {onClose && (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={onClose}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Item {progress.current} de {progress.total}
            </span>
            <span className="font-medium">{percent}%</span>
          </div>
          <Progress value={percent} className="h-2" />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Processando artigo com IA...
        </div>
      </CardContent>
    </Card>
  );
}
