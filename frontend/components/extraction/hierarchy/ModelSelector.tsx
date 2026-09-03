/**
 * Model Selector Component
 *
 * Repeating-group entry selector for hierarchical extraction.
 * Lets the user pick an entry via dropdown, add new ones, and remove the
 * active one.
 *
 * B-8 D6: the entry noun is DATA — the container's `entry_label` arrives
 * as the `entryLabel` prop (default 'model') and interpolates the
 * `{{noun}}` copy at render time; `title` carries the container's LABEL
 * (better than a pluralized noun for the heading).
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
import { Plus, Trash2, Sparkles, Loader2, ChevronDown, Pencil } from 'lucide-react';
import {t} from '@/lib/copy';
import {useRunEditability} from '@/components/runs/RunEditabilityContext';
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
  /** Rename / re-key the active entry (opens the page's rename dialog). */
  onRenameModel?: (instanceId: string) => void;
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
  /** Entry noun for `{{noun}}` copy interpolation (B-8 D6). */
  entryLabel?: string;
  /** Heading — the container's label; falls back to noun-generic copy. */
  title?: string;
}

// =================== COMPONENT ===================

export function ModelSelector({
  models,
  activeModelId,
  onSelectModel,
  onAddModel,
  onRemoveModel,
  onRenameModel,
  onExtractModels,
  extractingModels = false,
  loading = false,
  onExtractAllSections,
  extractingAllSections = false,
  onExtractAllSectionsForAllModels,
  extractingAllSectionsForAllModels = false,
  entryLabel = 'model',
  title,
}: ModelSelectorProps) {
  // Read-only run: add/remove/AI-extract affordances hide (published view).
  // Hook stays above the conditional loading/empty returns (rules of hooks).
  const { readOnly } = useRunEditability();
  const activeModel = models.find(m => m.instanceId === activeModelId);
  // {{noun}} resolves inline at each call site (D7); the heading's
  // fallback capitalizes the noun.
  const nounCap = entryLabel.charAt(0).toUpperCase() + entryLabel.slice(1);

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
              {t('extraction', 'noModelsAdded').replace('{{noun}}', entryLabel)}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {t('extraction', 'noModelsAddedDesc').replace('{{noun}}', entryLabel)}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            {!readOnly && onExtractModels && (
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
                    {t('extraction', 'extractingWithAI')}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                      {t('extraction', 'modelExtractAIShort')}
                  </>
                )}
              </Button>
            )}
            {!readOnly && (
              <Button onClick={onAddModel} size="default" variant="outline" className="gap-2">
                <Plus className="h-4 w-4" />
                  {t('extraction', 'addManually')}
              </Button>
            )}
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
            <h3 className="text-sm font-semibold text-foreground">
              {title ?? t('extraction', 'modelSelectorTitle').replace('{{noun}}', nounCap)}
            </h3>
          <p className="text-xs text-muted-foreground mt-1">
              {t('extraction', 'modelSelectorDesc').replace('{{noun}}', entryLabel)}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {!readOnly && onExtractModels && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  size="sm" 
                  variant="default"
                  className="gap-2"
                  disabled={extractingModels || extractingAllSectionsForAllModels}
                  title={t('extraction', 'modelExtractAITitle').replace('{{noun}}', entryLabel)}
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
                    {t('extraction', 'modelExtractModelsOnly').replace('{{noun}}', entryLabel)}
                </DropdownMenuItem>
                {onExtractAllSectionsForAllModels && (
                  <DropdownMenuItem 
                    onClick={onExtractAllSectionsForAllModels}
                    disabled={extractingModels || extractingAllSectionsForAllModels || models.length === 0}
                  >
                      {t('extraction', 'modelExtractAllSections').replace('{{noun}}', entryLabel)}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {!readOnly && (
            <Button
              onClick={onAddModel}
              size="sm"
              variant="outline"
              className="gap-2"
              title={t('extraction', 'modelAddManuallyTitle').replace('{{noun}}', entryLabel)}
            >
              <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{t('extraction', 'modelNewShort')}</span>
            </Button>
          )}
        </div>
      </div>

        {/* Selector and actions */}
      <div className="flex items-center gap-2">
        <Select value={activeModelId || undefined} onValueChange={onSelectModel}>
          <SelectTrigger className="flex-1">
              <SelectValue placeholder={t('extraction', 'selectModelPlaceholder').replace('{{noun}}', entryLabel)}/>
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

        {!readOnly && activeModelId && onRenameModel && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRenameModel(activeModelId)}
            title={t('extraction', 'modelRenameActiveTitle').replace('{{noun}}', entryLabel)}
            aria-label={t('extraction', 'modelRenameActiveTitle').replace('{{noun}}', entryLabel)}
            className="shrink-0"
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}

        {!readOnly && activeModelId && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRemoveModel(activeModelId)}
            title={t('extraction', 'modelRemoveActiveTitle').replace('{{noun}}', entryLabel)}
            className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
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
                <p className="text-xs text-muted-foreground">{t('extraction', 'modelActiveLabel').replace('{{noun}}', entryLabel)}</p>
              <p className="font-medium text-foreground mt-0.5 truncate">{activeModel.modelName}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {activeModel.progress && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {activeModel.progress.completed}/{activeModel.progress.total}
                  </span>
                  {renderProgressBadge(activeModel.progress)}
                </div>
              )}
              {!readOnly && onExtractAllSections && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="p-0 shrink-0"
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

