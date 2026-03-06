/**
 * Full AI extraction progress component
 *
 * Shows visual progress of full AI extraction:
 * - Stage 1: Extracting models
 * - Stage 2: Extracting sections from all models
 */

import {useState} from 'react';
import {Progress} from '@/components/ui/progress';
import {Card, CardContent, CardHeader} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Loader2, Maximize2, Minimize2, Sparkles, X} from 'lucide-react';
import type {FullAIExtractionProgress} from '@/hooks/extraction/useFullAIExtraction';
import {BatchAllModelsSectionsProgress} from './BatchAllModelsSectionsProgress';
import {calculateProgressPercent} from './helpers/progressHelpers';
import {t} from '@/lib/copy';

interface FullAIExtractionProgressProps {
  progress: FullAIExtractionProgress;
  onClose?: () => void;
  onMinimize?: () => void;
}

export function FullAIExtractionProgress({ progress, onClose, onMinimize }: FullAIExtractionProgressProps) {
  const { stage, modelsProgress, topLevelSectionsProgress } = progress;
  const [isMinimized, setIsMinimized] = useState(false);
  
  const isExtractingModels = stage === 'extracting_models';
  const isExtractingSections = stage === 'extracting_sections';

  const handleMinimize = () => {
    setIsMinimized(true);
    onMinimize?.();
  };

  const handleClose = () => {
    setIsMinimized(false);
    onClose?.();
  };

  const handleRestore = () => {
    setIsMinimized(false);
  };

  if (isMinimized) {
    return (
      <Card className="border-blue-200 bg-white shadow-lg">
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
              <span className="text-xs font-medium text-slate-900">
                {t('extraction', 'fullAIProgressInProgress')}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={handleRestore}
                title={t('extraction', 'fullAIProgressRestore')}
              >
                <Maximize2 className="h-3 w-3" />
              </Button>
              {onClose && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={handleClose}
                  title={t('extraction', 'fullAIProgressClose')}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-blue-200 bg-white shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-900">
                {t('extraction', 'fullAIProgressTitle')}
            </h3>
          </div>
          <div className="flex items-center gap-1">
            {onMinimize && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handleMinimize}
                title={t('extraction', 'fullAIProgressMinimize')}
              >
                <Minimize2 className="h-3.5 w-3.5" />
              </Button>
            )}
            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handleClose}
                title={t('extraction', 'fullAIProgressClose')}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-4">

            {/* Stage 1: Extracting models and top-level sections */}
          {isExtractingModels && (
            <div className="space-y-4">
                {/* Model extraction */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <Sparkles className="h-3 w-3" />
                    <span>{t('extraction', 'fullAIProgressExtractingModels')}</span>
                </div>
                <Progress value={undefined} className="h-2" />
              </div>

                {/* Top-level section extraction */}
              {topLevelSectionsProgress && (
                <div className="space-y-2 pt-2 border-t border-blue-200">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-slate-600">
                      <Sparkles className="h-3 w-3" />
                      <span>
                        {t('extraction', 'fullAIProgressExtractingSections').replace('{{label}}', topLevelSectionsProgress.currentSectionName || `${topLevelSectionsProgress.currentSection}/${topLevelSectionsProgress.totalSections}`)}
                      </span>
                    </div>
                    <span className="text-slate-500">
                      {calculateProgressPercent(
                        topLevelSectionsProgress.completedSections,
                        topLevelSectionsProgress.totalSections
                      )}%
                    </span>
                  </div>
                  <Progress
                    value={calculateProgressPercent(
                      topLevelSectionsProgress.completedSections,
                      topLevelSectionsProgress.totalSections
                    )}
                    className="h-2"
                  />
                </div>
              )}
            </div>
          )}

            {/* Stage 2: Extracting sections */}
          {isExtractingSections && modelsProgress && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <Sparkles className="h-3 w-3" />
                  <span>{t('extraction', 'fullAIProgressExtractingAllSections')}</span>
              </div>
              <div className="pt-2 border-t border-blue-200">
                <BatchAllModelsSectionsProgress progress={modelsProgress} />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

