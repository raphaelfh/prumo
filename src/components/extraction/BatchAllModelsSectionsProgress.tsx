/**
 * Componente de Progresso para Extração de Seções de Todos os Modelos
 * 
 * Mostra progresso visual da extração de seções de todos os modelos,
 * incluindo informações sobre modelos e seções do modelo atual.
 */

import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import type { AllModelsSectionsProgress } from '@/hooks/extraction/useBatchAllModelsSectionsExtraction';
import { BatchExtractionProgress } from './BatchExtractionProgress';

interface BatchAllModelsSectionsProgressProps {
  progress: AllModelsSectionsProgress;
}

export function BatchAllModelsSectionsProgress({ progress }: BatchAllModelsSectionsProgressProps) {
  const { currentModel, totalModels, currentModelName, sectionProgress } = progress;
  
  const modelsProgress = totalModels > 0 ? (currentModel / totalModels) * 100 : 0;

  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardContent className="pt-6">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-900">
              Extraindo seções de todos os modelos
            </h3>
          </div>

          {/* Progresso de modelos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">
                {currentModelName 
                  ? `Extraindo seções do modelo ${currentModel} de ${totalModels}: ${currentModelName}`
                  : `Modelo ${currentModel} de ${totalModels}`
                }
              </span>
              <span className="text-slate-500">
                {Math.round(modelsProgress)}%
              </span>
            </div>
            <Progress value={modelsProgress} className="h-2" />
          </div>

          {/* Progresso de seções do modelo atual */}
          {sectionProgress && (
            <div className="pt-2 border-t border-blue-200">
              <BatchExtractionProgress progress={sectionProgress} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

