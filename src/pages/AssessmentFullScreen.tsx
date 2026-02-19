/**
 * Interface Full Screen para Avaliação de Qualidade (Assessment)
 *
 * Página principal onde o usuário avalia a qualidade/risco de viés de um artigo específico.
 * Similar ao ExtractionFullScreen, com PDF viewer ao lado e formulário de avaliação.
 *
 * REFATORADO para usar novos hooks e componentes (DRY + KISS)
 * Baseado em ExtractionFullScreen.tsx
 *
 * Features:
 * - PDF viewer com toggle
 * - Formulário de avaliação por domínios
 * - Auto-save automático
 * - Sugestões de IA (prefill + badge)
 * - Progress tracking
 * - Navegação entre artigos
 *
 * @page
 */

import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { ResizablePanelGroup, ResizablePanel } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle } from 'lucide-react';

// Hooks
import { useAssessmentData } from '@/hooks/assessment/useAssessmentData';
import { useAssessmentResponses } from '@/hooks/assessment/useAssessmentResponses';
import { useAssessmentProgress } from '@/hooks/assessment/useAssessmentProgress';
import { useAssessmentAutoSave } from '@/hooks/assessment/useAssessmentAutoSave';
import { useAIAssessmentSuggestions } from '@/hooks/assessment/ai/useAIAssessmentSuggestions';
import { useSingleAssessment } from '@/hooks/assessment/ai/useSingleAssessment';
import { useBatchAssessment } from '@/hooks/assessment/ai/useBatchAssessment';
import { useCurrentUser } from '@/hooks/useCurrentUser';

// Components
import { AssessmentHeader } from '@/components/assessment/AssessmentHeader';
import { AssessmentPDFPanel } from '@/components/assessment/AssessmentPDFPanel';
import { AssessmentFormPanel } from '@/components/assessment/AssessmentFormPanel';
import { AssessmentHeaderAIActions } from '@/components/assessment/ai/AssessmentHeaderAIActions';
import { BatchAssessmentProgress } from '@/components/assessment/ai/BatchAssessmentProgress';

// Types
import type { AssessmentLevel, EvidencePassage } from '@/types/assessment';

// =================== COMPONENT ===================

export default function AssessmentFullScreen() {
  const { projectId, articleId, instrumentId } = useParams();
  const navigate = useNavigate();

  // UI state
  const [showPDF, setShowPDF] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { userId } = useCurrentUser();

  // Hook para carregar dados usando hook dedicado (SRP: separação de responsabilidades)
  const {
    article,
    project,
    instrument,
    items,
    domains,
    assessment,
    articles,
    loading,
    error: dataError,
    refresh,
    refreshAssessment,
  } = useAssessmentData({
    projectId: projectId || '',
    articleId: articleId || '',
    instrumentId: instrumentId || '',
    enabled: !!projectId && !!articleId && !!instrumentId,
  });

  // Hook para gerenciar respostas de assessment
  const {
    responses,
    updateResponse,
    save: saveResponses,
    loading: responsesLoading,
    initialized: responsesInitialized,
  } = useAssessmentResponses({
    projectId: projectId || '',
    articleId: articleId || '',
    instrumentId: instrumentId || '',
    extractionInstanceId: undefined, // Não é hierárquico (não por modelo)
    toolType: instrument?.tool_type,
    items,
    enabled: !!projectId && !!articleId && !!instrumentId,
  });

  // Hook para calcular progresso
  const { completedItems, totalItems, completionPercentage, isComplete } =
    useAssessmentProgress(responses, items);

  // Hook para auto-save (só habilitar após valores inicializados)
  const { isSaving, lastSaved } = useAssessmentAutoSave({
    responses,
    save: saveResponses,
    enabled: !!projectId && !!articleId && !!instrumentId && !loading && responsesInitialized,
  });

  // Callbacks para sugestões de IA
  const handleAISuggestionAccepted = useCallback(
    async (
      itemId: string,
      suggestionValue: { level: AssessmentLevel; evidence_passages: EvidencePassage[] }
    ) => {
      console.log('🤖 Aceitando sugestão de IA:', { itemId, suggestionValue });

      // Preencher o campo automaticamente quando sugestão é aceita
      updateResponse(itemId, {
        selected_level: suggestionValue.level,
        notes: null,
        evidence: suggestionValue.evidence_passages || [],
      });
    },
    [updateResponse]
  );

  const handleAISuggestionRejected = useCallback(
    async (itemId: string) => {
      console.log('🤖 Rejeitando sugestão de IA - limpando campo:', { itemId });
      // Clear the form field when suggestion is rejected (mirrors extraction pattern)
      updateResponse(itemId, {
        selected_level: '',
        notes: null,
        evidence: [],
      });
    },
    [updateResponse]
  );

  // Hook para sugestões de IA
  const {
    suggestions: aiSuggestions,
    acceptSuggestion,
    rejectSuggestion,
    batchAccept,
    getSuggestionsHistory,
    refresh: refreshSuggestions,
    isActionLoading,
  } = useAIAssessmentSuggestions({
    articleId: articleId || '',
    projectId: projectId || '',
    instrumentId,
    extractionInstanceId: undefined,
    enabled: !!articleId && !!projectId && !!instrumentId,
    onSuggestionAccepted: handleAISuggestionAccepted,
    onSuggestionRejected: handleAISuggestionRejected,
  });

  // Hook para avaliar item individual
  const [triggeringItemId, setTriggeringItemId] = useState<string | null>(null);
  const { assessItem, loading: assessingItem } = useSingleAssessment({
    onSuccess: async (suggestionId) => {
      console.log('✅ Item avaliado com sucesso:', { suggestionId });
      setTriggeringItemId(null);

      // Polling-based refresh (mirrors extraction's handleExtractionComplete pattern)
      (async () => {
        try {
          // Wait for backend sync
          await new Promise(resolve => setTimeout(resolve, 1500));

          console.log('🔄 Recarregando sugestões de IA...');
          let result = await refreshSuggestions();
          let foundSuggestions = result.count > 0;

          if (foundSuggestions) {
            console.log(`✅ ${result.count} sugestão(ões) encontrada(s) imediatamente`);
            return;
          }

          // Retry polling
          const maxAttempts = 5;
          const pollDelay = 1000;
          let attempts = 0;

          while (!foundSuggestions && attempts < maxAttempts) {
            attempts++;
            console.log(`🔄 Tentativa ${attempts + 1}/${maxAttempts + 1}: Recarregando sugestões...`);
            await new Promise(resolve => setTimeout(resolve, pollDelay));
            result = await refreshSuggestions();
            foundSuggestions = result.count > 0;

            if (foundSuggestions) {
              console.log(`✅ ${result.count} sugestão(ões) encontrada(s) após ${attempts + 1} tentativa(s)`);
              return;
            }
          }

          if (!foundSuggestions) {
            console.log('⚠️ Nenhuma sugestão encontrada após múltiplas tentativas');
          }
        } catch (error) {
          console.error('❌ Erro ao recarregar sugestões:', error);
        }
      })();
    },
  });

  // Handler para trigger de avaliação de item
  const handleTriggerAI = useCallback(
    async (itemId: string) => {
      setTriggeringItemId(itemId);
      try {
        await assessItem({
          projectId: projectId || '',
          articleId: articleId || '',
          instrumentId: instrumentId || '',
          assessmentItemId: itemId,
          model: 'gpt-4o-mini',
        });
      } catch (error) {
        console.error('❌ Erro ao avaliar item:', error);
        setTriggeringItemId(null);
      }
    },
    [projectId, articleId, instrumentId, assessItem]
  );

  // Hook para batch assessment
  const {
    assessBatch,
    loading: batchLoading,
    progress: batchProgress,
  } = useBatchAssessment({
    onComplete: async () => {
      // Polling-based refresh after batch (same pattern as single)
      await new Promise(resolve => setTimeout(resolve, 1500));
      let result = await refreshSuggestions();
      if (result.count > 0) return;

      let attempts = 0;
      while (attempts < 5) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 1000));
        result = await refreshSuggestions();
        if (result.count > 0) return;
      }
    },
  });

  // Handler para batch assessment
  const handleBatchAssess = useCallback(() => {
    assessBatch({
      projectId: projectId || '',
      articleId: articleId || '',
      instrumentId: instrumentId || '',
      items,
      existingResponses: responses,
    });
  }, [projectId, articleId, instrumentId, items, responses, assessBatch]);

  // State for batch progress visibility
  const [showBatchProgress, setShowBatchProgress] = useState(true);

  // Navegação entre artigos
  const handleNavigateToArticle = (newArticleId: string) => {
    navigate(`/projects/${projectId}/assessment/${newArticleId}/${instrumentId}`);
  };

  // Finalizar avaliação
  const handleSubmit = async () => {
    if (!isComplete) {
      toast.error('Complete todas as perguntas obrigatórias antes de finalizar');
      return;
    }

    setSubmitting(true);
    try {
      // Salvar respostas finais
      await saveResponses();

      // Atualizar status para submitted
      if (!userId) {
        throw new Error('Usuário não autenticado');
      }

      const { error } = await supabase
        .from('assessments')
        .update({ status: 'submitted' })
        .eq('article_id', articleId)
        .eq('instrument_id', instrumentId)
        .eq('user_id', userId)
        .eq('is_current_version', true);

      if (error) throw error;

      toast.success('Avaliação concluída com sucesso!');
      navigate(`/projects/${projectId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao finalizar avaliação';
      console.error('❌ Erro ao finalizar avaliação:', error);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  // Loading state
  if (loading || responsesLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Error state
  if (dataError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-destructive">Erro ao carregar dados</p>
        <Button onClick={() => navigate(`/projects/${projectId}`)}>Voltar ao Projeto</Button>
      </div>
    );
  }

  // No instrument state
  if (!instrument) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-muted-foreground">Nenhum instrumento configurado</p>
        <Button onClick={() => navigate(`/projects/${projectId}`)}>Voltar ao Projeto</Button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <AssessmentHeader
        projectName={project?.name || 'Projeto'}
        instrumentName={instrument?.name || ''}
        articleTitle={article?.title || ''}
        onBack={() => navigate(`/projects/${projectId}?tab=assessment`)}
        articles={articles}
        currentArticleId={articleId || ''}
        onNavigateToArticle={handleNavigateToArticle}
        completedItems={completedItems}
        totalItems={totalItems}
        completionPercentage={completionPercentage}
        showPDF={showPDF}
        onTogglePDF={() => setShowPDF(!showPDF)}
        showComparison={false}
        onToggleComparison={() => {}}
        hasOtherAssessments={false}
        canUndo={false}
        canRedo={false}
        onUndo={() => {}}
        onRedo={() => {}}
        isSaving={isSaving}
        lastSaved={lastSaved}
        isComplete={isComplete}
        onFinalize={handleSubmit}
        submitting={submitting}
        aiActions={
          <AssessmentHeaderAIActions
            suggestions={aiSuggestions}
            onBatchAssess={handleBatchAssess}
            batchLoading={batchLoading}
            batchProgress={batchProgress}
            onBatchAccept={batchAccept}
          />
        }
      />

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* PDF Panel */}
          {showPDF && (
            <AssessmentPDFPanel
              articleId={articleId || ''}
              projectId={projectId || ''}
              showPDF={showPDF}
            />
          )}

          {/* Assessment Form Panel */}
          <ResizablePanel defaultSize={showPDF ? 50 : 100} minSize={30}>
            <AssessmentFormPanel
              formViewProps={{
                domains,
                responses,
                onResponseChange: (itemId, response) => updateResponse(itemId, response),
                aiSuggestions,
                onAcceptAI: acceptSuggestion,
                onRejectAI: rejectSuggestion,
                onTriggerAI: handleTriggerAI,
                isActionLoading: (itemId) => !!isActionLoading(itemId),
                isTriggerLoading: (itemId) => assessingItem && triggeringItemId === itemId,
                triggeringItemId: assessingItem ? triggeringItemId : null,
                getSuggestionsHistory,
                disabled: false,
              }}
            />

            {/* Submit Button */}
            <div className="p-8 border-t bg-white">
              <div className="flex justify-end">
                <Button
                  size="lg"
                  onClick={handleSubmit}
                  disabled={submitting || !isComplete || isSaving}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Finalizando...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Concluir Avaliação
                    </>
                  )}
                </Button>
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Floating Batch Progress */}
      {batchLoading && batchProgress && showBatchProgress && (
        <BatchAssessmentProgress
          progress={batchProgress}
          onClose={() => setShowBatchProgress(false)}
        />
      )}
    </div>
  );
}
