import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Sparkles, Play, Loader2, X, CheckCircle, Zap, Settings } from 'lucide-react';
import { useBatchAIAssessment } from '@/hooks/assessment/useBatchAIAssessment';
import { AssessmentItem } from '@/hooks/assessment/useAssessmentInstruments';
import { AIGlobalConfigModal } from './AIGlobalConfigModal';

interface BatchAssessmentBarProps {
  projectId: string;
  articleId: string;
  instrumentId: string;
  items: AssessmentItem[];
  responses: Record<string, { level: string; comment?: string }>;
  onResponseChange: (itemCode: string, level: string) => void;
  onCommentChange: (itemCode: string, comment: string) => void;
}

export const BatchAssessmentBar = ({
  projectId,
  articleId,
  instrumentId,
  items,
  responses,
  onResponseChange,
  onCommentChange
}: BatchAssessmentBarProps) => {
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [globalConfig, setGlobalConfig] = useState({
    parallelMode: false,
    concurrency: 3,
    delayBetweenBatches: 1000
  });
  
  const {
    isProcessing,
    currentItem,
    totalItems,
    currentItemQuestion,
    unansweredItems,
    completedItems,
    handleBatchAssessment,
    cancelBatchAssessment,
  } = useBatchAIAssessment({
    projectId,
    articleId,
    instrumentId,
    items,
    responses,
    onResponseChange,
    onCommentChange,
  });

  // Sempre mostra a barra, mesmo sem itens
  // if (items.length === 0) {
  //   return null;
  // }

  const progressPercentage = totalItems > 0 ? Math.min((currentItem / totalItems) * 100, 100) : 0;

  return (
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-blue-50 shadow-sm mb-4">
      <CardContent className="p-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium text-xs">Avaliação Inteligente</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="outline" className="gap-0.5 text-xs px-1.5 py-0.5">
                <CheckCircle className="h-2.5 w-2.5" />
                {completedItems.length}
              </Badge>
              <Badge variant="outline" className="gap-0.5 text-xs px-1.5 py-0.5">
                <Play className="h-2.5 w-2.5" />
                {unansweredItems.length}
              </Badge>
              {globalConfig.parallelMode && (
                <Badge variant="secondary" className="gap-0.5 text-xs px-1.5 py-0.5">
                  <Zap className="h-2.5 w-2.5" />
                  {globalConfig.concurrency}x
                </Badge>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-1.5">
            {/* Botão de Configurações Minimalista */}
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 h-6 px-1.5 text-xs"
              onClick={() => setShowConfigModal(true)}
              title="Configurações globais de IA"
            >
              <Settings className="h-3 w-3" />
              <span className="hidden sm:inline">Config</span>
              {globalConfig.parallelMode && (
                <Badge variant="secondary" className="ml-1 text-xs px-1 py-0">
                  {globalConfig.concurrency}x
                </Badge>
              )}
            </Button>
            
            {isProcessing ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  <span className="text-xs font-medium">
                    {currentItem}/{totalItems} ({Math.round(progressPercentage)}%)
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={cancelBatchAssessment}
                  className="gap-1 h-6 text-xs px-2"
                >
                  <X className="h-3 w-3" />
                  Cancelar
                </Button>
              </div>
            ) : (
              <Button
                onClick={handleBatchAssessment}
                disabled={unansweredItems.length === 0}
                size="sm"
                className="gap-1 h-6 text-xs px-2"
                title={globalConfig.parallelMode ? `Modo paralelo (${globalConfig.concurrency}x mais rápido)` : 'Modo sequencial (seguro)'}
              >
                <Play className="h-3 w-3" />
                Avaliar Todas ({unansweredItems.length})
              </Button>
            )}
          </div>
        </div>
        
        
        {isProcessing && (
          <div className="mt-2 space-y-1">
            <Progress value={progressPercentage} className="h-1.5" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate max-w-[200px]">Processando: {currentItemQuestion}</span>
              <span>{Math.round(progressPercentage)}%</span>
            </div>
          </div>
        )}
      </CardContent>
      
      {/* Modal de Configurações Globais */}
      <AIGlobalConfigModal
        open={showConfigModal}
        onOpenChange={setShowConfigModal}
        projectId={projectId}
        items={items}
        onConfigChange={(config) => {
          setGlobalConfig({
            parallelMode: config.parallelMode,
            concurrency: config.concurrency,
            delayBetweenBatches: config.delayBetweenBatches
          });
        }}
      />
    </Card>
  );
};
