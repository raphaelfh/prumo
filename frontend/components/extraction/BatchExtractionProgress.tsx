/**
 * Batch extraction progress component with chunking
 *
 * Shows visual progress of extracting all sections of a model,
 * including chunk and section processing info.
 */

import {Progress} from '@/components/ui/progress';
import {Card, CardContent} from '@/components/ui/card';
import {Loader2} from 'lucide-react';
import type {ExtractionProgress} from '@/hooks/extraction/useBatchSectionExtractionChunked';
import {t} from '@/lib/copy';

interface BatchExtractionProgressProps {
  progress: ExtractionProgress;
}

export function BatchExtractionProgress({ progress }: BatchExtractionProgressProps) {
  const { currentChunk, totalChunks, completedSections, totalSections, currentSectionName } = progress;
  
  // Progresso de chunks: chunks completados (currentChunk - 1) / total
    // When currentChunk = 1 we are still on the first chunk (0% complete)
    // When currentChunk = totalChunks + 1, all chunks are complete (100%)
  const chunksProgress = totalChunks > 0 ? ((currentChunk - 1) / totalChunks) * 100 : 0;
  const sectionsProgress = totalSections > 0 ? (completedSections / totalSections) * 100 : 0;

  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardContent className="pt-6">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-900">
                {t('extraction', 'batchExtractingAllSections')}
            </h3>
          </div>

          {/* Progresso de chunks */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">
                {t('extraction', 'batchChunkOf').replace('{{current}}', String(currentChunk)).replace('{{total}}', String(totalChunks))}
              </span>
              <span className="text-slate-500">
                {Math.round(chunksProgress)}%
              </span>
            </div>
            <Progress value={chunksProgress} className="h-2" />
          </div>

            {/* Section progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">
                {t('extraction', 'batchSectionsOf').replace('{{completed}}', String(completedSections)).replace('{{total}}', String(totalSections))}
              </span>
              <span className="text-slate-500">
                {Math.round(sectionsProgress)}%
              </span>
            </div>
            <Progress value={sectionsProgress} className="h-2" />
          </div>

            {/* Current section */}
          {currentSectionName && (
            <div className="text-xs text-slate-500 italic">
                {t('extraction', 'batchProcessing').replace('{{name}}', currentSectionName)}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

