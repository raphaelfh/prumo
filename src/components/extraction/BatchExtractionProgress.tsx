/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Componente de Progresso para Extração em Batch com Chunking
 * 
 * Mostra progresso visual da extração de todas as seções de um modelo,
 * incluindo informações sobre chunks e seções sendo processadas.
 */

import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import type { ExtractionProgress } from '@/hooks/extraction/useBatchSectionExtractionChunked';

interface BatchExtractionProgressProps {
  progress: ExtractionProgress;
}

export function BatchExtractionProgress({ progress }: BatchExtractionProgressProps) {
  const { currentChunk, totalChunks, completedSections, totalSections, currentSectionName } = progress;
  
  // Progresso de chunks: chunks completados (currentChunk - 1) / total
  // Quando currentChunk = 1, ainda estamos no primeiro chunk (0% completado)
  // Quando currentChunk = totalChunks + 1, todos os chunks foram completados (100%)
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
              Extraindo todas as seções do modelo
            </h3>
          </div>

          {/* Progresso de chunks */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">
                Chunk {currentChunk} de {totalChunks}
              </span>
              <span className="text-slate-500">
                {Math.round(chunksProgress)}%
              </span>
            </div>
            <Progress value={chunksProgress} className="h-2" />
          </div>

          {/* Progresso de seções */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">
                Seções: {completedSections} de {totalSections}
              </span>
              <span className="text-slate-500">
                {Math.round(sectionsProgress)}%
              </span>
            </div>
            <Progress value={sectionsProgress} className="h-2" />
          </div>

          {/* Seção atual */}
          {currentSectionName && (
            <div className="text-xs text-slate-500 italic">
              Processando: {currentSectionName}...
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

