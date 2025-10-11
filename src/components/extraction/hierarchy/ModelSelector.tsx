/**
 * Model Selector Component
 * 
 * Seletor de modelos de predição para extração hierárquica.
 * Permite navegar entre múltiplos modelos, adicionar novos e remover existentes.
 * 
 * Features:
 * - Tabs responsivos (desktop) / Dropdown (mobile)
 * - Badge com progresso por modelo
 * - Botão para adicionar novo modelo
 * - Ícone X para remover modelo (com hover)
 * - Indicação visual do modelo ativo
 * 
 * @component
 */

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, X, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

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
  loading?: boolean;
}

// =================== COMPONENT ===================

export function ModelSelector({
  models,
  activeModelId,
  onSelectModel,
  onAddModel,
  onRemoveModel,
  loading = false
}: ModelSelectorProps) {
  const isMobile = useIsMobile();

  // Encontrar modelo ativo
  const activeModel = useMemo(() => {
    return models.find(m => m.instanceId === activeModelId);
  }, [models, activeModelId]);

  // Renderizar badge de progresso
  const renderProgressBadge = (model: Model) => {
    if (!model.progress) return null;

    const { percentage, completed, total } = model.progress;
    const variant = percentage === 100 ? 'default' : percentage > 0 ? 'secondary' : 'outline';
    const bgColor = percentage === 100 ? 'bg-green-500' : percentage > 0 ? 'bg-blue-500' : '';

    return (
      <Badge
        variant={variant}
        className={cn('text-xs ml-2', bgColor && `${bgColor} text-white`)}
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
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-dashed border-blue-200 rounded-lg p-8">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
            <ChevronRight className="h-8 w-8 text-blue-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">
            Nenhum modelo adicionado
          </h3>
          <p className="text-sm text-slate-600 mb-4 max-w-md mx-auto">
            Para extrair dados de modelos de predição, adicione pelo menos um modelo.
            Você poderá adicionar quantos modelos quiser.
          </p>
          <Button onClick={onAddModel} size="lg" className="gap-2">
            <Plus className="h-5 w-5" />
            Adicionar Primeiro Modelo
          </Button>
        </div>
      </div>
    );
  }

  // Mobile: Dropdown
  if (isMobile) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Modelo Ativo</h3>
          <Button onClick={onAddModel} size="sm" variant="outline" className="gap-1">
            <Plus className="h-4 w-4" />
            Novo
          </Button>
        </div>

        <Select value={activeModelId || undefined} onValueChange={onSelectModel}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecionar modelo..." />
          </SelectTrigger>
          <SelectContent>
            {models.map((model) => (
              <SelectItem key={model.instanceId} value={model.instanceId}>
                <div className="flex items-center justify-between w-full">
                  <span>{model.modelName}</span>
                  {renderProgressBadge(model)}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {activeModel && activeModel.progress && (
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Progresso:</span>
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {activeModel.progress.completed}/{activeModel.progress.total}
                </span>
                <Badge variant="secondary" className="text-xs">
                  {activeModel.progress.percentage}%
                </Badge>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Desktop: Tabs
  return (
    <div className="bg-white border rounded-lg shadow-sm">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Modelos de Predição</h3>
            <p className="text-xs text-slate-500 mt-1">
              Selecione um modelo para extrair seus dados
            </p>
          </div>
          <Button onClick={onAddModel} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Novo Modelo
          </Button>
        </div>

        <Tabs value={activeModelId || undefined} onValueChange={onSelectModel}>
          <TabsList className="w-full justify-start overflow-x-auto h-auto p-1 bg-slate-100">
            {models.map((model) => (
              <div key={model.instanceId} className="relative group">
                <TabsTrigger
                  value={model.instanceId}
                  className={cn(
                    'relative px-4 py-2 gap-2 data-[state=active]:bg-white',
                    'data-[state=active]:shadow-sm transition-all'
                  )}
                >
                  <span className="font-medium">{model.modelName}</span>
                  {renderProgressBadge(model)}
                </TabsTrigger>
                
                {/* Botão remover (aparece no hover) - FORA do TabsTrigger para evitar button dentro de button */}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRemoveModel(model.instanceId);
                  }}
                  className={cn(
                    'absolute -top-2 -right-2 p-1 rounded-full',
                    'bg-destructive text-destructive-foreground',
                    'opacity-0 group-hover:opacity-100 transition-opacity',
                    'hover:bg-destructive/90 shadow-sm z-10'
                  )}
                  title={`Remover ${model.modelName}`}
                  type="button"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Informações do modelo ativo */}
      {activeModel && (
        <div className="p-4 bg-slate-50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600">Modelo Ativo</p>
              <p className="font-semibold text-slate-900 mt-1">{activeModel.modelName}</p>
            </div>
            {activeModel.progress && (
              <div className="text-right">
                <p className="text-xs text-slate-600 mb-1">Progresso de Extração</p>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {activeModel.progress.completed}/{activeModel.progress.total}
                  </span>
                  <Badge
                    variant={activeModel.progress.percentage === 100 ? 'default' : 'secondary'}
                    className={cn(
                      activeModel.progress.percentage === 100 && 'bg-green-500'
                    )}
                  >
                    {activeModel.progress.percentage}%
                  </Badge>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

