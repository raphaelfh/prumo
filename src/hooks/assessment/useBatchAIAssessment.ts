import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { AssessmentItem } from './useAssessmentInstruments';
import { aiAssessmentClient } from '@/integrations/api/client';

interface BatchAIAssessmentProps {
  projectId: string;
  articleId: string;
  instrumentId: string;
  items: AssessmentItem[];
  responses: Record<string, { level: string; comment?: string }>;
  onResponseChange: (itemCode: string, level: string) => void;
  onCommentChange: (itemCode: string, comment: string) => void;
}

interface BatchAIAssessmentResult {
  isProcessing: boolean;
  currentItem: number;
  totalItems: number;
  currentItemQuestion: string;
  unansweredItems: AssessmentItem[];
  completedItems: AssessmentItem[];
  handleBatchAssessment: () => Promise<void>;
  cancelBatchAssessment: () => void;
}

export const useBatchAIAssessment = ({
  projectId,
  articleId,
  instrumentId,
  items,
  responses,
  onResponseChange,
  onCommentChange
}: BatchAIAssessmentProps): BatchAIAssessmentResult => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentItem, setCurrentItem] = useState(0);
  const [isCancelled, setIsCancelled] = useState(false);
  const { toast } = useToast();

  // Calcula itens não respondidos e respondidos
  const unansweredItems = items.filter(item => !responses[item.item_code]?.level);
  const completedItems = items.filter(item => responses[item.item_code]?.level);

  const getPdfStorageKey = async (): Promise<string> => {
    const { data, error } = await supabase
      .from('article_files')
      .select('id, file_type, storage_key, original_filename, created_at')
      .eq('article_id', articleId)
      .ilike('file_type', '%pdf%')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      throw new Error(`Erro ao buscar arquivos do artigo: ${error.message}`);
    }
    const file = data?.[0];
    const pdfStorageKey = file?.storage_key;

    if (!pdfStorageKey) {
      throw new Error('Nenhum PDF encontrado para este artigo. Faça upload do PDF primeiro.');
    }
    return pdfStorageKey;
  };

  const executeAIForItem = async (item: AssessmentItem) => {
    try {
      const pdfStorageKey = await getPdfStorageKey();

      const payload = {
        projectId,
        articleId,
        assessmentItemId: item.id,
        instrumentId,
        pdfStorageKey: pdfStorageKey,
        forceFileSearch: false, // Configuração padrão otimizada
      };

      // Usa o cliente FastAPI ao invés de Edge Function
      // O apiClient retorna data diretamente se a request for bem-sucedida
      // e lança ApiError se falhar
      const assessment = await aiAssessmentClient<{
        id: string;
        selectedLevel: string;
        confidenceScore: number;
        justification: string;
        evidencePassages: Array<{
          text: string;
          page_number?: number;
        }>;
      }>(payload);

      if (!assessment) {
        throw new Error('Resposta da API sem assessment.');
      }

      // Mapeia para o formato esperado pelo hook (snake_case)
      return {
        selected_level: assessment.selectedLevel,
        confidence_score: assessment.confidenceScore,
        justification: assessment.justification,
        evidence_passages: assessment.evidencePassages,
      };
    } catch (error) {
      console.error(`[Batch AI Assessment] Erro para item ${item.item_code}:`, error);
      throw error;
    }
  };

  const processInParallelBatches = async (
    items: AssessmentItem[],
    config: { concurrency: number; delayBetweenBatches: number },
    callbacks: {
      onItemComplete: (item: AssessmentItem, result: any) => void;
      onItemError: (item: AssessmentItem, error: any) => void;
    }
  ) => {
    const { concurrency, delayBetweenBatches } = config;
    
    // Divide os itens em lotes
    const batches: AssessmentItem[][] = [];
    for (let i = 0; i < items.length; i += concurrency) {
      batches.push(items.slice(i, i + concurrency));
    }

    console.log(`[Batch AI Assessment] Processando ${items.length} itens em ${batches.length} lotes de até ${concurrency} itens`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      // Verifica se foi cancelado
      if (isCancelled) {
        console.log(`[Batch AI Assessment] Processamento cancelado no lote ${batchIndex + 1}`);
        break;
      }

      const batch = batches[batchIndex];
      console.log(`[Batch AI Assessment] Processando lote ${batchIndex + 1}/${batches.length} com ${batch.length} itens`);

      // Processa o lote em paralelo
      const promises = batch.map(async (item) => {
        try {
          const result = await executeAIForItem(item);
          callbacks.onItemComplete(item, result);
          return { success: true, item, result };
        } catch (error) {
          callbacks.onItemError(item, error);
          return { success: false, item, error };
        }
      });

      // Aguarda todos os itens do lote terminarem
      await Promise.allSettled(promises);

      // Delay entre lotes (exceto no último lote)
      if (batchIndex < batches.length - 1 && delayBetweenBatches > 0) {
        console.log(`[Batch AI Assessment] Aguardando ${delayBetweenBatches}ms antes do próximo lote`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }
  };

  const handleBatchAssessment = useCallback(async () => {
    if (isProcessing || unansweredItems.length === 0) return;
    
    setIsProcessing(true);
    setIsCancelled(false);
    setCurrentItem(0);
    
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    try {
      // Carrega configurações do localStorage
      const savedConfig = localStorage.getItem('ai-global-config');
      const config = savedConfig ? JSON.parse(savedConfig) : {
        parallelMode: false,
        concurrency: 3,
        delayBetweenBatches: 1000
      };

      if (config.parallelMode && config.concurrency > 1) {
        // Processamento paralelo em lotes
        await processInParallelBatches(unansweredItems, config, {
          onItemComplete: (item, result) => {
            successCount++;
            setCurrentItem(successCount + errorCount);
            
            // Aplica resultado
            const evidenceBlock =
              result.evidence_passages?.map((e: any) => {
                const page = e.page_number != null ? ` (p.${e.page_number})` : '';
                return `• ${e.text}${page}`;
              }).join('\n') ?? '';

            const comment = `${result.justification}\n\n--- Evidências ---\n${evidenceBlock}`;
            
            onResponseChange(item.item_code, result.selected_level);
            onCommentChange(item.item_code, comment);
          },
          onItemError: (item, error) => {
            errorCount++;
            setCurrentItem(successCount + errorCount);
            const errorMsg = `Item ${item.item_code}: ${error.message}`;
            errors.push(errorMsg);
            console.error(`[Batch AI Assessment] Erro no item ${item.item_code}:`, error);
          }
        });
      } else {
        // Processamento sequencial (modo original)
        for (let i = 0; i < unansweredItems.length; i++) {
          // Verifica se foi cancelado
          if (isCancelled) {
            break;
          }

          const item = unansweredItems[i];
          setCurrentItem(i + 1);
          
          try {
            // Executa IA para o item
            const result = await executeAIForItem(item);
            
            // Aplica resultado
            const evidenceBlock =
              result.evidence_passages?.map((e: any) => {
                const page = e.page_number != null ? ` (p.${e.page_number})` : '';
                return `• ${e.text}${page}`;
              }).join('\n') ?? '';

            const comment = `${result.justification}\n\n--- Evidências ---\n${evidenceBlock}`;
            
            onResponseChange(item.item_code, result.selected_level);
            onCommentChange(item.item_code, comment);
            
            successCount++;
            
            // Pequeno delay para UX e evitar rate limiting
            await new Promise(resolve => setTimeout(resolve, 800));
            
          } catch (error: any) {
            errorCount++;
            const errorMsg = `Item ${item.item_code}: ${error.message}`;
            errors.push(errorMsg);
            console.error(`[Batch AI Assessment] Erro no item ${item.item_code}:`, error);
            
            // Continua para o próximo item mesmo com erro
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }

      // Feedback final
      if (isCancelled) {
        toast({
          title: 'Avaliação em lote cancelada',
          description: `${successCount} itens processados antes do cancelamento`,
        });
      } else if (errorCount === 0) {
        toast({
          title: 'Avaliação em lote concluída',
          description: `${successCount} itens processados com sucesso`,
        });
      } else {
        toast({
          title: 'Avaliação em lote concluída com erros',
          description: `${successCount} sucessos, ${errorCount} erros. Verifique o console para detalhes.`,
          variant: 'destructive',
        });
      }

    } catch (error: any) {
      console.error('[Batch AI Assessment] Erro geral:', error);
      toast({
        title: 'Erro na avaliação em lote',
        description: error.message || 'Erro desconhecido',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
      setCurrentItem(0);
      setIsCancelled(false);
    }
  }, [
    isProcessing,
    unansweredItems,
    projectId,
    articleId,
    instrumentId,
    onResponseChange,
    onCommentChange,
    isCancelled,
    toast
  ]);

  const cancelBatchAssessment = useCallback(() => {
    setIsCancelled(true);
  }, []);

  return {
    isProcessing,
    currentItem,
    totalItems: unansweredItems.length,
    currentItemQuestion: unansweredItems[currentItem - 1]?.question || '',
    unansweredItems,
    completedItems,
    handleBatchAssessment,
    cancelBatchAssessment,
  };
};
