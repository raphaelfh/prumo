/**
 * Progress component for extracting sections from all models.
 * Shows visual progress including current model and section info.
 */

import {Progress} from '@/components/ui/progress';
import {Card, CardContent} from '@/components/ui/card';
import {Loader2} from 'lucide-react';
import type {AllModelsSectionsProgress} from '@/hooks/extraction/useBatchAllModelsSectionsExtraction';
import {BatchExtractionProgress} from './BatchExtractionProgress';

interface BatchAllModelsSectionsProgressProps {
  progress: AllModelsSectionsProgress;
}

export function BatchAllModelsSectionsProgress({ progress }: BatchAllModelsSectionsProgressProps) {
  const { currentModel, totalModels, currentModelName, sectionProgress } = progress;
  
  const modelsProgress = totalModels > 0 ? (currentModel / totalModels) * 100 : 0;

  return (
    <Card className="border-info/30 bg-info/5">
      <CardContent className="pt-6">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-info" />
            <h3 className="text-sm font-semibold text-foreground">
                Extracting sections from all models
            </h3>
          </div>

            {/* Model progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {currentModelName
                    ? `Extracting sections from model ${currentModel} of ${totalModels}: ${currentModelName}`
                    : `Model ${currentModel} of ${totalModels}`
                }
              </span>
              <span className="text-muted-foreground">
                {Math.round(modelsProgress)}%
              </span>
            </div>
            <Progress value={modelsProgress} className="h-2" />
          </div>

            {/* Current model section progress */}
          {sectionProgress && (
            <div className="pt-2 border-t border-info/20">
              <BatchExtractionProgress progress={sectionProgress} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

