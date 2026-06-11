/**
 * Model Selector Component
 *
 * Prediction model selector for hierarchical extraction.
 * Permite selecionar modelo via dropdown, adicionar novos e remover o ativo.
 * 
 * Features:
 * - Dropdown limpo e minimalista
 * - Badge with progress per model
 * - Button to add new model
 * - Button to remove active model
 * - Automatic AI extraction
 * 
 * @component
 */

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, Sparkles, Loader2, ChevronDown } from 'lucide-react';
import {t} from '@/lib/copy';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// =================== INTERFACES ===================

export interface Model {
  instanceId: string;
  modelName: string;
  progress?: {
    completed: number;
    total: number;
    percentage: number;
  };
}

interface ModelSelectorProps {
  models: Model[];
  activeModelId: string | null;
  onSelectModel: (instanceId: string) => void;
  onAddModel: () => void;
  onRemoveModel: (instanceId: string) => void;
  onExtractModels?: () => Promise<void>;
  extractingModels?: boolean;
  loading?: boolean;
    // Props for extracting all sections of one model
  onExtractAllSections?: () => Promise<void>;
  extractingAllSections?: boolean;
    // Props for extracting sections from all models
  onExtractAllSectionsForAllModels?: () => Promise<void>;
  extractingAllSectionsForAllModels?: boolean;
  projectId?: string;
  articleId?: string;
  templateId?: string;
}

// =================== COMPONENT ===================

export function ModelSelector({
  models,
  activeModelId,
  onSelectModel,
  onAddModel,
  onRemoveModel,
  onExtractModels,
  extractingModels = false,
  loading = false,
  onExtractAllSections,
  extractingAllSections = false,
  onExtractAllSectionsForAllModels,
  extractingAllSectionsForAllModels = false,
}: ModelSelectorProps) {
  const activeModel = models.find(m => m.instanceId === activeModelId);

  // Renderizar badge de progresso (semantic tokens; flips correctly in dark mode)
  const renderProgressBadge = (progress?: Model['progress']) => {
    if (!progress) return null;

    const { percentage, completed, total } = progress;
    if (percentage === 100) {
      return (
        <Badge className="bg-success text-success-foreground text-xs hover:bg-success/90">
          {completed}/{total}
        </Badge>
      );
    }
    if (percentage > 0) {
      return (
        <Badge className="bg-info text-info-foreground text-xs hover:bg-info/90">
          {completed}/{total}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-xs">
        {completed}/{total}
      </Badge>
    );
  };

  // Loading state
  if (loading) {
    return (
      <div className="rounded-lg border border-border/60 bg-card p-4">
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

    // Empty state (no models)
  if (models.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-info/30 bg-info/5 p-6">
        <div className="text-center">
          <h3 className="text-base font-semibold text-foreground mb-2">
              {t('extraction', 'noModelsAdded')}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Adicione um modelo manualmente ou extraia automaticamente do artigo.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            {onExtractModels && (
              <Button 
                onClick={onExtractModels} 
                size="default" 
                variant="default"
                className="gap-2"
                disabled={extractingModels}
              >
                {extractingModels ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Extraindo...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                      Extract with AI
                  </>
                )}
              </Button>
            )}
            <Button onClick={onAddModel} size="default" variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
                {t('extraction', 'addManually')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

    // Interface with dropdown
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4 space-y-4 shadow-elev-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-foreground">{t('extraction', 'modelSelectorTitle')}</h3>
          <p className="text-xs text-muted-foreground mt-1">
              {t('extraction', 'modelSelectorDesc')}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {onExtractModels && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  size="sm" 
                  variant="default"
                  className="gap-2"
                  disabled={extractingModels || extractingAllSectionsForAllModels}
                  title={t('extraction', 'modelExtractAITitle')}
                >
                  {extractingModels || extractingAllSectionsForAllModels ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                    <span className="hidden sm:inline">{t('extraction', 'modelExtractAIShort')}</span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem 
                  onClick={onExtractModels}
                  disabled={extractingModels || extractingAllSectionsForAllModels}
                >
                    {t('extraction', 'modelExtractModelsOnly')}
                </DropdownMenuItem>
                {onExtractAllSectionsForAllModels && (
                  <DropdownMenuItem 
                    onClick={onExtractAllSectionsForAllModels}
                    disabled={extractingModels || extractingAllSectionsForAllModels || models.length === 0}
                  >
                      {t('extraction', 'modelExtractAllSections')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button 
            onClick={onAddModel} 
            size="sm" 
            variant="outline" 
            className="gap-2"
            title={t('extraction', 'modelAddManuallyTitle')}
          >
            <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t('extraction', 'modelNewShort')}</span>
          </Button>
        </div>
      </div>

        {/* Selector and actions */}
      <div className="flex items-center gap-2">
        <Select value={activeModelId || undefined} onValueChange={onSelectModel}>
          <SelectTrigger className="flex-1">
              <SelectValue placeholder={t('extraction', 'selectModelPlaceholder')}/>
          </SelectTrigger>
          <SelectContent>
            {models.map((model) => (
              <SelectItem key={model.instanceId} value={model.instanceId}>
                <div className="flex items-center gap-2">
                  <span>{model.modelName}</span>
                  {renderProgressBadge(model.progress)}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {activeModelId && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRemoveModel(activeModelId)}
            title={t('extraction', 'modelRemoveActiveTitle')}
            className="flex-shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

        {/* Active model info */}
      {activeModel && (
        <div className="rounded-lg border border-border/40 bg-muted/40 p-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{t('extraction', 'modelActiveLabel')}</p>
              <p className="font-medium text-foreground mt-0.5 truncate">{activeModel.modelName}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {activeModel.progress && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {activeModel.progress.completed}/{activeModel.progress.total}
                  </span>
                  {renderProgressBadge(activeModel.progress)}
                </div>
              )}
              {onExtractAllSections && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          onExtractAllSections();
                        }}
                        disabled={extractingAllSections}
                        title={t('extraction', 'extractAllSectionsWithAI')}
                      >
                        {extractingAllSections ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        ) : (
                          <Sparkles className="h-4 w-4 text-primary" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        {extractingAllSections
                            ? t('extraction', 'extractingAllSectionsWithAI')
                            : t('extraction', 'extractAllSectionsWithAI')}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

