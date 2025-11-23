/**
 * Model Selector Component
 * 
 * Seletor de modelos de predição para extração hierárquica.
 * Permite selecionar modelo via dropdown, adicionar novos e remover o ativo.
 * 
 * Features:
 * - Dropdown limpo e minimalista
 * - Badge com progresso por modelo
 * - Botão para adicionar novo modelo
 * - Botão para remover modelo ativo
 * - Extração automática com IA
 * 
 * @component
 */

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, Sparkles, Loader2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  // Props para extração de todas as seções de um modelo
  onExtractAllSections?: () => Promise<void>;
  extractingAllSections?: boolean;
  // Props para extração de seções de todos os modelos
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
  // Encontrar modelo ativo
  const activeModel = useMemo(() => {
    return models.find(m => m.instanceId === activeModelId);
  }, [models, activeModelId]);

  // Renderizar badge de progresso
  const renderProgressBadge = (progress?: Model['progress']) => {
    if (!progress) return null;

    const { percentage, completed, total } = progress;
    const variant = percentage === 100 ? 'default' : percentage > 0 ? 'secondary' : 'outline';
    const bgColor = percentage === 100 ? 'bg-green-500' : percentage > 0 ? 'bg-blue-500' : '';

    return (
      <Badge
        variant={variant}
        className={cn('text-xs', bgColor && `${bgColor} text-white`)}
      >
        {completed}/{total}
      </Badge>
    );
  };

  // Loading state
  if (loading) {
    return (
      <div className="bg-white border rounded-lg p-4 animate-pulse">
        <div className="h-10 bg-slate-200 rounded"></div>
      </div>
    );
  }

  // Empty state (sem modelos)
  if (models.length === 0) {
    return (
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-dashed border-blue-200 rounded-lg p-6">
        <div className="text-center">
          <h3 className="text-base font-semibold text-slate-900 mb-2">
            Nenhum modelo adicionado
          </h3>
          <p className="text-sm text-slate-600 mb-4">
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
                    Extrair com IA
                  </>
                )}
              </Button>
            )}
            <Button onClick={onAddModel} size="default" variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              Adicionar Manualmente
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Interface com dropdown
  return (
    <div className="bg-white border rounded-lg shadow-sm p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900">Modelos de Predição</h3>
          <p className="text-xs text-slate-500 mt-1">
            Selecione um modelo para extrair seus dados
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
                  title="Extrair modelos automaticamente com IA"
                >
                  {extractingModels || extractingAllSectionsForAllModels ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">Extrair IA</span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem 
                  onClick={onExtractModels}
                  disabled={extractingModels || extractingAllSectionsForAllModels}
                >
                  Extrair apenas modelos
                </DropdownMenuItem>
                {onExtractAllSectionsForAllModels && (
                  <DropdownMenuItem 
                    onClick={onExtractAllSectionsForAllModels}
                    disabled={extractingModels || extractingAllSectionsForAllModels || models.length === 0}
                  >
                    Extrair seções de todos os modelos
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
            title="Adicionar novo modelo manualmente"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Novo</span>
          </Button>
        </div>
      </div>

      {/* Selector e ações */}
      <div className="flex items-center gap-2">
        <Select value={activeModelId || undefined} onValueChange={onSelectModel}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Selecione um modelo..." />
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
            title="Remover modelo ativo"
            className="flex-shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Informações do modelo ativo */}
      {activeModel && (
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-600">Modelo Ativo</p>
              <p className="font-medium text-slate-900 mt-0.5 truncate">{activeModel.modelName}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {activeModel.progress && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-700">
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
                        title="Extrair todas as seções do modelo com IA"
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
                          ? "Extraindo todas as seções com IA..."
                          : "Extrair todas as seções do modelo com IA"}
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

