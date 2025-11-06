import { supabase } from '@/integrations/supabase/client';
import { callEdgeFunction } from '@/lib/supabase/baseRepository';
import { AssessmentItem } from '@/hooks/assessment/useAssessmentInstruments';

export interface BatchAssessmentConfig {
  parallelMode: boolean;
  concurrency: number;
  delayBetweenBatches: number;
  model: string;
  temperature: number;
  maxTokens: number;
  forceFileSearch: boolean;
  systemPrompt: string;
  userPromptTemplate: string;
}

export interface BatchAssessmentTask {
  articleId: string;
  articleTitle: string;
  itemId: string;
  itemCode: string;
  itemQuestion: string;
}

export interface BatchAssessmentResult {
  task: BatchAssessmentTask;
  success: boolean;
  result?: {
    selected_level: string;
    justification: string;
    evidence_passages?: Array<{
      text: string;
      page_number?: number;
    }>;
  };
  error?: string;
}

export interface BatchAssessmentProgress {
  total: number;
  completed: number;
  successful: number;
  failed: number;
  currentTask?: BatchAssessmentTask;
}

export class BatchAssessmentService {
  private cancelled = false;
  private onProgressCallback?: (progress: BatchAssessmentProgress) => void;

  constructor(onProgress?: (progress: BatchAssessmentProgress) => void) {
    this.onProgressCallback = onProgress;
  }

  /**
   * Cancela o processamento em batch
   */
  cancel() {
    this.cancelled = true;
  }

  /**
   * Reseta o estado de cancelamento
   */
  reset() {
    this.cancelled = false;
  }

  /**
   * Obtém a chave de armazenamento do PDF do artigo
   */
  private async getPdfStorageKey(articleId: string): Promise<string> {
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
  }

  /**
   * Executa a avaliação de IA para um item específico de um artigo
   */
  private async executeAIAssessment(
    projectId: string,
    articleId: string,
    item: AssessmentItem,
    instrumentId: string,
    config: BatchAssessmentConfig
  ): Promise<any> {
    const clientTraceId = crypto.randomUUID();
    
    try {
      const pdfStorageKey = await this.getPdfStorageKey(articleId);

      const payload = {
        projectId,
        articleId,
        assessmentItemId: item.id,
        instrumentId,
        pdf_storage_key: pdfStorageKey,
        force_file_search: config.forceFileSearch,
        // Configurações adicionais podem ser passadas aqui
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      };

      // Usar callEdgeFunction do baseRepository com headers customizados
      const result = await callEdgeFunction(
        'ai-assessment',
        payload,
        {
          headers: {
            'x-client-trace-id': clientTraceId,
          },
        }
      );

      // Extrair assessment da resposta (pode estar em result.assessment ou result diretamente)
      const assessment = (result as any)?.assessment ?? result;
      if (!assessment) {
        throw new Error('Resposta da função sem assessment.');
      }

      return assessment;
    } catch (error) {
      console.error(`[Batch Assessment] Erro ao processar item ${item.item_code}:`, error);
      throw error;
    }
  }

  /**
   * Salva o resultado da avaliação no banco de dados
   */
  private async saveAssessmentResult(
    projectId: string,
    articleId: string,
    instrumentId: string,
    itemCode: string,
    result: any
  ): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Usuário não autenticado');
      }

      // Busca o assessment existente
      const { data: existingAssessment, error: fetchError } = await supabase
        .from('assessments')
        .select('id, responses')
        .eq('project_id', projectId)
        .eq('article_id', articleId)
        .eq('instrument_id', instrumentId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (fetchError) throw fetchError;

      // Prepara a evidência formatada
      const evidenceBlock =
        result.evidence_passages?.map((e: any) => {
          const page = e.page_number != null ? ` (p.${e.page_number})` : '';
          return `• ${e.text}${page}`;
        }).join('\n') ?? '';

      const comment = `${result.justification}\n\n--- Evidências ---\n${evidenceBlock}`;

      // Atualiza as respostas
      const responses = existingAssessment?.responses || {};
      responses[itemCode] = {
        level: result.selected_level,
        comment,
      };

      // Calcula percentual de conclusão
      const totalItems = Object.keys(responses).length;
      const completedItems = Object.values(responses).filter((r: any) => r.level).length;
      const completionPercentage = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

      if (existingAssessment?.id) {
        // Atualiza assessment existente
        const { error: updateError } = await supabase
          .from('assessments')
          .update({
            responses,
            completion_percentage: completionPercentage,
            status: completionPercentage === 100 ? 'submitted' : 'in_progress',
          })
          .eq('id', existingAssessment.id);

        if (updateError) throw updateError;
      } else {
        // Cria novo assessment
        const { error: insertError } = await supabase
          .from('assessments')
          .insert({
            project_id: projectId,
            article_id: articleId,
            instrument_id: instrumentId,
            user_id: user.id,
            responses,
            completion_percentage: completionPercentage,
            status: completionPercentage === 100 ? 'submitted' : 'in_progress',
            tool_type: 'ai_batch',
          });

        if (insertError) throw insertError;
      }
    } catch (error) {
      console.error('[Batch Assessment] Erro ao salvar resultado:', error);
      throw error;
    }
  }

  /**
   * Processa um lote de tarefas em paralelo
   */
  private async processBatch(
    tasks: BatchAssessmentTask[],
    projectId: string,
    instrumentId: string,
    config: BatchAssessmentConfig,
    progress: BatchAssessmentProgress,
    allItems: AssessmentItem[]
  ): Promise<BatchAssessmentResult[]> {
    const results: BatchAssessmentResult[] = [];

    const promises = tasks.map(async (task) => {
      if (this.cancelled) {
        return {
          task,
          success: false,
          error: 'Processamento cancelado',
        };
      }

      // Atualiza progresso
      if (this.onProgressCallback) {
        this.onProgressCallback({
          ...progress,
          currentTask: task,
        });
      }

      try {
        const item = allItems.find(i => i.id === task.itemId);
        if (!item) {
          throw new Error(`Item ${task.itemCode} não encontrado`);
        }

        // Executa avaliação de IA
        const result = await this.executeAIAssessment(
          projectId,
          task.articleId,
          item,
          instrumentId,
          config
        );

        // Salva resultado
        await this.saveAssessmentResult(
          projectId,
          task.articleId,
          instrumentId,
          task.itemCode,
          result
        );

        // Atualiza progresso
        progress.completed++;
        progress.successful++;
        if (this.onProgressCallback) {
          this.onProgressCallback(progress);
        }

        return {
          task,
          success: true,
          result,
        };
      } catch (error: any) {
        // Atualiza progresso
        progress.completed++;
        progress.failed++;
        if (this.onProgressCallback) {
          this.onProgressCallback(progress);
        }

        console.error(`[Batch Assessment] Erro na tarefa:`, error);
        return {
          task,
          success: false,
          error: error.message || 'Erro desconhecido',
        };
      }
    });

    const settledResults = await Promise.allSettled(promises);
    
    settledResults.forEach((settled) => {
      if (settled.status === 'fulfilled') {
        results.push(settled.value);
      } else {
        console.error('[Batch Assessment] Promise rejeitada:', settled.reason);
      }
    });

    return results;
  }

  /**
   * Executa o processamento em batch de múltiplos artigos e itens
   */
  async processBatchAssessment(
    projectId: string,
    instrumentId: string,
    selectedArticles: Array<{ id: string; title: string }>,
    selectedItems: AssessmentItem[],
    config: BatchAssessmentConfig
  ): Promise<BatchAssessmentResult[]> {
    this.reset();

    // Cria todas as tarefas (combinações de artigo x item)
    const tasks: BatchAssessmentTask[] = [];
    for (const article of selectedArticles) {
      for (const item of selectedItems) {
        tasks.push({
          articleId: article.id,
          articleTitle: article.title,
          itemId: item.id,
          itemCode: item.item_code,
          itemQuestion: item.question,
        });
      }
    }

    console.log(`[Batch Assessment] Iniciando processamento de ${tasks.length} tarefas`);
    console.log(`[Batch Assessment] Configuração:`, {
      parallelMode: config.parallelMode,
      concurrency: config.concurrency,
      delayBetweenBatches: config.delayBetweenBatches,
    });

    const progress: BatchAssessmentProgress = {
      total: tasks.length,
      completed: 0,
      successful: 0,
      failed: 0,
    };

    // Emite progresso inicial
    if (this.onProgressCallback) {
      this.onProgressCallback(progress);
    }

    const allResults: BatchAssessmentResult[] = [];

    if (config.parallelMode && config.concurrency > 1) {
      // Processamento paralelo em lotes
      const batches: BatchAssessmentTask[][] = [];
      for (let i = 0; i < tasks.length; i += config.concurrency) {
        batches.push(tasks.slice(i, i + config.concurrency));
      }

      console.log(`[Batch Assessment] Processando em ${batches.length} lotes de até ${config.concurrency} tarefas`);

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        if (this.cancelled) {
          console.log(`[Batch Assessment] Processamento cancelado no lote ${batchIndex + 1}`);
          break;
        }

        const batch = batches[batchIndex];
        console.log(`[Batch Assessment] Processando lote ${batchIndex + 1}/${batches.length}`);

        const batchResults = await this.processBatch(
          batch,
          projectId,
          instrumentId,
          config,
          progress,
          selectedItems
        );

        allResults.push(...batchResults);

        // Delay entre lotes (exceto no último)
        if (batchIndex < batches.length - 1 && config.delayBetweenBatches > 0 && !this.cancelled) {
          console.log(`[Batch Assessment] Aguardando ${config.delayBetweenBatches}ms antes do próximo lote`);
          await new Promise(resolve => setTimeout(resolve, config.delayBetweenBatches));
        }
      }
    } else {
      // Processamento sequencial
      console.log(`[Batch Assessment] Processando sequencialmente`);

      for (let i = 0; i < tasks.length; i++) {
        if (this.cancelled) {
          console.log(`[Batch Assessment] Processamento cancelado na tarefa ${i + 1}`);
          break;
        }

        const task = tasks[i];
        const batchResults = await this.processBatch(
          [task],
          projectId,
          instrumentId,
          config,
          progress,
          selectedItems
        );

        allResults.push(...batchResults);

        // Pequeno delay entre tarefas para UX
        if (i < tasks.length - 1 && !this.cancelled) {
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      }
    }

    console.log(`[Batch Assessment] Processamento finalizado:`, {
      total: progress.total,
      completed: progress.completed,
      successful: progress.successful,
      failed: progress.failed,
      cancelled: this.cancelled,
    });

    return allResults;
  }
}

