/**
 * Interface Full Screen para Extração de Dados
 * 
 * Página principal onde o usuário extrai dados de um artigo específico.
 * Similar ao AssessmentFullScreen, com PDF viewer ao lado e formulário de extração.
 * 
 * Features:
 * - PDF viewer com toggle
 * - Formulário de extração por seções
 * - Auto-save automático
 * - Colaboração multi-usuário (popover + grid)
 * - Sugestões de IA (prefill + badge)
 * - Progress tracking
 * 
 * @page
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { extractionInstanceService } from '@/services/extractionInstanceService';
import { extractionLogger } from '@/lib/extraction/observability';
import { errorTracker } from '@/services/errorTracking';
import { ResizablePanelGroup, ResizablePanel } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

// Hooks
import { useExtractionData } from '@/hooks/extraction/useExtractionData';
import { useExtractedValues } from '@/hooks/extraction/useExtractedValues';
import { useExtractionProgress } from '@/hooks/extraction/useExtractionProgress';
import { useExtractionAutoSave } from '@/hooks/extraction/useExtractionAutoSave';
import { useOtherExtractions } from '@/hooks/extraction/colaboracao/useOtherExtractions';
import { useAISuggestions } from '@/hooks/extraction/ai/useAISuggestions';
import { useComparisonPermissions } from '@/hooks/shared/useComparisonPermissions';

// Components
import { ExtractionHeader } from '@/components/extraction/ExtractionHeader';
import { ExtractionPDFPanel } from '@/components/extraction/ExtractionPDFPanel';
import { ExtractionFormPanel } from '@/components/extraction/ExtractionFormPanel';
import { AddModelDialog, RemoveModelDialog } from '@/components/extraction/hierarchy';
import { FullAIExtractionProgress } from '@/components/extraction/FullAIExtractionProgress';

// Hooks adicionais
import { useModelManagement } from '@/hooks/extraction/useModelManagement';

// =================== COMPONENT ===================

export default function ExtractionFullScreen() {
  const { projectId, articleId } = useParams();
  const navigate = useNavigate();

  // Carregar dados usando hook dedicado (SRP: separação de responsabilidades)
  const {
    article,
    project,
    template,
    entityTypes,
    instances,
    articles,
    loading,
    error: dataError,
    refreshInstances,
  } = useExtractionData({
    projectId,
    articleId,
    enabled: !!projectId && !!articleId,
  });

  // Estado local
  const [submitting, setSubmitting] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');

  // UI state
  const [showPDF, setShowPDF] = useState(true);
  const [viewMode, setViewMode] = useState<'extract' | 'compare'>('extract');
  
  // Estado de progresso de extração IA
  const [aiExtractionState, setAiExtractionState] = useState<{
    loading: boolean;
    progress: any;
  } | null>(null);
  const [isProgressMinimized, setIsProgressMinimized] = useState(false);
  
  // Hierarchy state
  const [showAddModelDialog, setShowAddModelDialog] = useState(false);
  const [modelToRemove, setModelToRemove] = useState<{
    id: string; 
    name: string;
    hasData: boolean;
    fieldsCount: number;
  } | null>(null);

  // Hook para gerenciar valores extraídos
  const {
    values,
    updateValue,
    loading: valuesLoading,
    initialized: valuesInitialized,
    save: saveValues,
    refresh: refreshValues
  } = useExtractedValues({
    articleId: articleId || '',
    projectId: projectId || '',
    enabled: !!articleId && !!projectId
  });

  // Hook para calcular progresso
  const { completedFields, totalFields, completionPercentage, isComplete } = 
    useExtractionProgress(values, entityTypes);

  // Hook para auto-save (só habilitar após valores inicializados)
  const { isSaving, lastSaved } = useExtractionAutoSave({
    articleId: articleId || '',
    projectId: projectId || '',
    values,
    enabled: !!articleId && !!projectId && !loading && valuesInitialized
  });

  // Hook de permissões (controla acesso a comparação)
  const permissions = useComparisonPermissions(
    projectId || '',
    currentUserId
  );

  // Hook para outras extrações (colaboração) - controlado por permissões
  const { otherExtractions } = useOtherExtractions({
    articleId: articleId || '',
    projectId: projectId || '',
    currentUserId,
    enabled: permissions.canSeeOthers && !!currentUserId
  });

  // Hook para sugestões de IA com callbacks para preencher/limpar campo
  const handleAISuggestionAccepted = useCallback(async (instanceId: string, fieldId: string, value: any) => {
    // Preencher o campo automaticamente quando sugestão é aceita
    console.log('🤖 Aceitando sugestão de IA:', { instanceId, fieldId, value });
    // updateValue atualiza o estado local imediatamente
    // O serviço AISuggestionService.acceptSuggestion já salva no banco
    // Não é necessário recarregar todos os valores (refreshValues causava recarregamento da página)
    updateValue(instanceId, fieldId, value);
  }, [updateValue]);

  const handleAISuggestionRejected = useCallback(async (instanceId: string, fieldId: string) => {
    // Limpar o campo quando sugestão é rejeitada
    console.log('🤖 Rejeitando sugestão de IA - limpando campo:', { instanceId, fieldId });
    // updateValue atualiza o estado local imediatamente
    // O serviço AISuggestionService.rejectSuggestion já atualiza o status no banco
    // Não é necessário recarregar todos os valores (refreshValues causava recarregamento da página)
    updateValue(instanceId, fieldId, null);
  }, [updateValue]);

  const { 
    suggestions: aiSuggestions, 
    acceptSuggestion, 
    rejectSuggestion, 
    getSuggestionsHistory,
    refresh: refreshAISuggestions,
    isActionLoading 
  } = useAISuggestions({
    articleId: articleId || '',
    projectId: projectId || '',
    enabled: !!articleId && !!projectId,
    onSuggestionAccepted: handleAISuggestionAccepted,
    onSuggestionRejected: handleAISuggestionRejected
  });

  // Identificar model parent entity type
  const modelParentEntityType = entityTypes.find(et => et.name === 'prediction_models');
  
  // Hook para gerenciamento de modelos
  const {
    models,
    activeModelId,
    setActiveModelId,
    loading: modelsLoading,
    createModel,
    removeModel,
    refreshModels,
    getModelProgress
  } = useModelManagement({
    projectId: projectId || '',
    articleId: articleId || '',
    templateId: template?.id || '',
    modelParentEntityTypeId: modelParentEntityType?.id || null,
    enabled: !!template && !!modelParentEntityType
  });

  // Persistência do modelo ativo no localStorage
  useEffect(() => {
    if (activeModelId && articleId) {
      localStorage.setItem(`active-model-${articleId}`, activeModelId);
    }
  }, [activeModelId, articleId]);

  // Restaurar modelo ativo ao carregar
  useEffect(() => {
    if (articleId && models.length > 0 && !activeModelId) {
      const saved = localStorage.getItem(`active-model-${articleId}`);
      if (saved && models.some(m => m.instanceId === saved)) {
        setActiveModelId(saved);
      } else {
        setActiveModelId(models[0].instanceId);
      }
    }
  }, [articleId, models, activeModelId, setActiveModelId]);

  // =================== MEMOIZAÇÕES PARA PERFORMANCE ===================

  // ✅ Memoizar entity types filtrados (evita recalcular a cada render)
  const studyLevelSections = useMemo(
    () => entityTypes.filter(et => !et.parent_entity_type_id && et.name !== 'prediction_models'),
    [entityTypes]
  );

  const modelChildSections = useMemo(
    () => entityTypes.filter(et => et.parent_entity_type_id === modelParentEntityType?.id),
    [entityTypes, modelParentEntityType]
  );

  // ✅ Memoizar função de filtro de instances (evita recrear função)
  const getInstancesForModel = useCallback((entityTypeId: string, modelId: string) => {
    return instances.filter(
      i => i.entity_type_id === entityTypeId && i.parent_instance_id === modelId
    );
  }, [instances]);

  // Removido: SectionAccordion não precisa memo, FieldInput é memoizado individualmente

  // Carregar usuário atual
  useEffect(() => {
    const loadUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
      }
    };
    loadUser();
  }, []);

  // Redirecionar se erro crítico
  useEffect(() => {
    if (dataError && projectId) {
      toast.error(dataError);
      navigate(`/projects/${projectId}?tab=extraction`);
    }
  }, [dataError, projectId, navigate]);

  // Função para recarregar instâncias (usada após extração de modelos)
  const handleRefreshInstances = useCallback(async () => {
    await refreshInstances();
  }, [refreshInstances]);

  const handleBack = () => {
    navigate(`/projects/${projectId}?tab=extraction`);
  };

  const handleNavigateToArticle = (newArticleId: string) => {
    navigate(`/projects/${projectId}/extraction/${newArticleId}`);
  };

  // Handlers para gerenciamento de modelos
  const handleAddModel = () => {
    setShowAddModelDialog(true);
  };

  const handleConfirmAddModel = async (modelName: string, modellingMethod: string) => {
    console.log('🎯 Iniciando criação de modelo:', modelName);
    const result = await createModel(modelName, modellingMethod);
    
    if (result) {
      console.log('✅ Modelo criado com sucesso:', result.model);
      setShowAddModelDialog(false);
      
      // ✅ CORREÇÃO: Recarregar apenas instâncias (child instances serão incluídas)
      // Não chamar refreshModels() - o hook já atualiza o estado local
      await refreshInstances();
      
      console.log('✅ Estado atualizado, campos devem aparecer imediatamente!');
    }
  };

  const handleRemoveModel = async (instanceId: string) => {
    const model = models.find(m => m.instanceId === instanceId);
    if (!model) return;

    // Calcular se tem dados extraídos
    const progress = await getModelProgress(instanceId);
    const hasData = !!(progress && progress.completed > 0);

    setModelToRemove({ 
      id: instanceId, 
      name: model.modelName,
      hasData,
      fieldsCount: progress?.completed || 0
    });
  };

  const handleConfirmRemoveModel = async () => {
    if (!modelToRemove) return;
    
    try {
      extractionLogger.info('removeModelHandler', 'Iniciando remoção de modelo', {
        modelId: modelToRemove.id,
        modelName: modelToRemove.name,
        hasData: modelToRemove.hasData,
        fieldsCount: modelToRemove.fieldsCount
      });

      const modelIdToRemove = modelToRemove.id;
      
      // ✅ Remover modelo (já atualiza estado local)
      await removeModel(modelIdToRemove);
      
      extractionLogger.info('removeModelHandler', 'Modelo removido com sucesso', {
        modelId: modelIdToRemove,
        modelName: modelToRemove.name
      });

      // Fechar dialog imediatamente após remoção bem-sucedida
      setModelToRemove(null);
      
      // ✅ CORREÇÃO: Não chamar refreshModels() - o hook já atualiza o estado local
      // Apenas recarregar instâncias para garantir que child instances sejam removidas da UI
      try {
        await refreshInstances();
        extractionLogger.info('removeModelHandler', 'Estado atualizado, modelo removido da interface', {
          modelId: modelIdToRemove,
          instancesRemoved: instances.filter(i => 
            i.id === modelIdToRemove || i.parent_instance_id === modelIdToRemove
          ).length
        });
      } catch (refreshError: any) {
        // Log do erro mas não re-throw - modelo já foi removido com sucesso
        extractionLogger.error('removeModelHandler', 'Erro ao recarregar instâncias após remoção', refreshError, {
          modelId: modelIdToRemove
        });
        // Não bloquear o fluxo - modelo já foi removido do estado local
      }
      
    } catch (error: any) {
      // ✅ Re-throw para o modal capturar e exibir erro
      extractionLogger.error('removeModelHandler', 'Falha ao remover modelo', error, {
        modelId: modelToRemove.id,
        modelName: modelToRemove.name
      });
      throw error;
    }
  };

  const handleAddInstance = async (entityTypeId: string) => {
    if (!template) return;

    try {
      extractionLogger.info('handleAddInstance', 'Iniciando criação de instância', {
        entityTypeId,
        templateId: template.id
      });

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      // Encontrar entity type
      const entityType = entityTypes.find(et => et.id === entityTypeId);
      if (!entityType) {
        extractionLogger.warn('handleAddInstance', 'Entity type não encontrado', { entityTypeId });
        return;
      }

      // Determinar parent_instance_id se for uma entity type hierárquica
      let parentInstanceId: string | undefined = undefined;
      
      // Se tem parent_entity_type_id, é uma child entity (ex: model child sections)
      if (entityType.parent_entity_type_id) {
        // Se o parent é prediction_models, usar activeModelId
        if (entityType.parent_entity_type_id === modelParentEntityType?.id) {
          if (!activeModelId) {
            toast.error('Selecione um modelo antes de adicionar esta seção');
            return;
          }
          parentInstanceId = activeModelId;
        } else {
          // Para outras hierarquias, buscar parent instance
          const parentInstance = instances.find(
            i => i.entity_type_id === entityType.parent_entity_type_id
          );
          if (parentInstance) {
            parentInstanceId = parentInstance.id;
          } else {
            toast.error('Instância pai não encontrada. Crie a seção pai primeiro.');
            return;
          }
        }
      }

      // Contar instâncias existentes para gerar label (considerar mesmo parent)
      const existingCount = instances.filter(i => 
        i.entity_type_id === entityTypeId && 
        i.parent_instance_id === (parentInstanceId || null)
      ).length;
      
      // Gerar label único
      let newLabel: string;
      if (parentInstanceId) {
        // Para child instances, incluir referência ao parent para evitar conflitos
        const parentInstance = instances.find(i => i.id === parentInstanceId);
        newLabel = parentInstance 
          ? `${parentInstance.label} - ${entityType.label} ${existingCount + 1}`
          : `${entityType.label} ${existingCount + 1}`;
      } else {
        newLabel = `${entityType.label} ${existingCount + 1}`;
      }

      extractionLogger.debug('handleAddInstance', 'Criando instância via service', {
        entityTypeId,
        entityTypeName: entityType.name,
        parentInstanceId,
        label: newLabel
      });

      // ✅ MELHORIA: Usar service layer em vez de INSERT direto
      // Isso garante validações, logs e consistência
      const result = await extractionInstanceService.createInstance({
        projectId: projectId!,
        articleId: articleId!,
        templateId: template.id,
        entityTypeId,
        entityType,
        parentInstanceId,
        label: newLabel,
        userId: user.id
      });

      if (result.wasCreated) {
        // Recarregar instâncias após criar
        await refreshInstances();
        
        extractionLogger.info('handleAddInstance', 'Instância criada com sucesso', {
          instanceId: result.instance.id,
          label: result.instance.label
        });
        
        toast.success(`${result.instance.label} adicionado com sucesso`);
      } else {
        extractionLogger.info('handleAddInstance', 'Instância já existia', {
          instanceId: result.instance.id,
          label: result.instance.label
        });
        
        toast.info('Instância já existe');
      }

    } catch (error: any) {
      extractionLogger.error('handleAddInstance', 'Falha ao criar instância', error, {
        entityTypeId,
        templateId: template.id
      });
      
      console.error('Erro ao adicionar instância:', error);
      toast.error(`Erro ao adicionar instância: ${error.message}`);
    }
  };

  const handleRemoveInstance = async (instanceId: string) => {
    try {
      // Verificar se tem valores extraídos
      const hasValues = Object.keys(values).some(key => key.startsWith(`${instanceId}_`));

      if (hasValues) {
        const confirmed = window.confirm(
          'Esta instância tem valores extraídos. Tem certeza que deseja remover?'
        );
        if (!confirmed) return;
      }

      const { error } = await supabase
        .from('extraction_instances')
        .delete()
        .eq('id', instanceId);

      if (error) throw error;

      // Recarregar instâncias após remover
      await refreshInstances();
      toast.success('Instância removida com sucesso');

    } catch (error: any) {
      console.error('Erro ao remover instância:', error);
      toast.error('Erro ao remover instância');
    }
  };

  const handleFinalize = async () => {
    if (!isComplete) {
      toast.error('Complete todos os campos obrigatórios antes de finalizar');
      return;
    }

    // Validar dados necessários
    if (!articleId || !projectId) {
      extractionLogger.error('handleFinalize', 'Dados incompletos para finalizar extração', undefined, {
        articleId,
        projectId
      });
      toast.error('Erro: Dados do artigo não encontrados');
      return;
    }

    // Validar se há instâncias para atualizar
    if (!instances || instances.length === 0) {
      extractionLogger.warn('handleFinalize', 'Nenhuma instância encontrada para finalizar', {
        articleId,
        projectId
      });
      toast.error('Erro: Nenhuma instância de extração encontrada');
      return;
    }

    setSubmitting(true);

    const logger = extractionLogger;
    logger.info('handleFinalize', 'Iniciando finalização de extração', {
      articleId,
      projectId,
      instancesCount: instances.length,
      instanceIds: instances.map(i => i.id)
    });

    try {
      // 1. Salvar valores pendentes
      logger.debug('handleFinalize', 'Salvando valores pendentes...', {
        valuesCount: Object.keys(values).length
      });

      try {
        await saveValues();
        logger.info('handleFinalize', 'Valores salvos com sucesso');
      } catch (saveError: any) {
        logger.error('handleFinalize', 'Erro ao salvar valores pendentes', saveError as Error, {
          errorMessage: saveError.message,
          errorCode: saveError.code
        });
        
        errorTracker.captureError(
          saveError instanceof Error ? saveError : new Error(saveError?.message || 'Erro desconhecido ao salvar valores'),
          {
            component: 'ExtractionFullScreen',
            action: 'handleFinalize',
            projectId,
            articleId,
            metadata: {
              step: 'saveValues',
              errorCode: saveError?.code,
              errorDetails: saveError?.details
            }
          }
        );

        throw new Error(`Erro ao salvar valores: ${saveError.message || 'Erro desconhecido'}`);
      }

      // 2. Atualizar status das instâncias
      const instanceIds = instances.map(i => i.id);
      logger.debug('handleFinalize', 'Atualizando status das instâncias...', {
        instanceIds,
        instancesCount: instanceIds.length
      });

      const { error: updateError, data: updatedData } = await supabase
        .from('extraction_instances')
        .update({
          status: 'completed'
          // ❌ Removido: completed_at não existe na tabela extraction_instances
          // (existe apenas em extraction_runs)
        })
        .eq('article_id', articleId)
        .in('id', instanceIds)
        .select('id, status'); // Retornar dados para confirmar atualização

      if (updateError) {
        logger.error('handleFinalize', 'Erro ao atualizar status das instâncias', updateError as Error, {
          errorCode: updateError.code,
          errorMessage: updateError.message,
          errorDetails: updateError.details,
          instanceIds,
          articleId
        });

        errorTracker.captureError(
          new Error(updateError.message || 'Erro ao atualizar status das instâncias'),
          {
            component: 'ExtractionFullScreen',
            action: 'handleFinalize',
            projectId,
            articleId,
            metadata: {
              step: 'updateInstances',
              errorCode: updateError.code,
              errorDetails: updateError.details,
              instanceIds
            }
          }
        );

        // Mensagem de erro mais específica baseada no código de erro
        let errorMessage = 'Erro ao atualizar status das instâncias';
        if (updateError.code === 'PGRST301' || updateError.message.includes('permission denied')) {
          errorMessage = 'Erro de permissão: Você não tem permissão para finalizar esta extração';
        } else if (updateError.code === '23503' || updateError.message.includes('foreign key')) {
          errorMessage = 'Erro: Dados relacionados não encontrados. Recarregue a página e tente novamente';
        } else if (updateError.message) {
          errorMessage = `Erro: ${updateError.message}`;
        }

        throw new Error(errorMessage);
      }

      // Confirmar que instâncias foram atualizadas
      const updatedCount = updatedData?.length || 0;
      if (updatedCount === 0) {
        logger.warn('handleFinalize', 'Nenhuma instância foi atualizada', {
          instanceIds,
          articleId
        });
        throw new Error('Nenhuma instância foi atualizada. Verifique as permissões e tente novamente');
      }

      if (updatedCount < instanceIds.length) {
        logger.warn('handleFinalize', 'Algumas instâncias não foram atualizadas', {
          expected: instanceIds.length,
          actual: updatedCount,
          instanceIds
        });
      }

      logger.info('handleFinalize', 'Extração finalizada com sucesso', {
        articleId,
        instancesUpdated: updatedCount,
        totalInstances: instanceIds.length
      });

      toast.success('Extração finalizada com sucesso!');
      handleBack();

    } catch (error: any) {
      // Erro já foi logado e capturado acima, apenas exibir mensagem ao usuário
      const errorMessage = error instanceof Error 
        ? error.message 
        : (error?.message || 'Erro desconhecido ao finalizar extração');

      logger.error('handleFinalize', 'Falha ao finalizar extração', error instanceof Error ? error : new Error(errorMessage), {
        articleId,
        projectId,
        finalError: errorMessage
      });

      toast.error(errorMessage, {
        duration: 6000
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Loading state
  if (loading || valuesLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Carregando interface de extração...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (!article || !template) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-destructive">Erro ao carregar dados</p>
          <Button onClick={handleBack}>Voltar</Button>
        </div>
      </div>
    );
  }

  // Template sem campos configurados
  if (entityTypes.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center space-y-6 max-w-md">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Nenhum campo para extração</h3>
            <p className="text-muted-foreground">
              O template <strong>{template?.name}</strong> não possui campos configurados para extração de dados.
            </p>
          </div>
          
          <div className="bg-muted/50 p-4 rounded-lg space-y-2 text-sm">
            <p className="font-medium">Para resolver:</p>
            <ul className="text-left space-y-1 text-muted-foreground">
              <li>• Entre em contato com o gerente do projeto</li>
              <li>• Solicite a configuração dos campos de extração</li>
              <li>• Ou configure um novo template com campos</li>
            </ul>
          </div>
          
          <Button onClick={handleBack}>Voltar</Button>
        </div>
      </div>
    );
  }

  /**
   * Handler chamado após extração de seção ser concluída
   * 
   * Faz refresh de sugestões e valores extraídos em background.
   * Usa polling para garantir que sugestões sejam carregadas quando disponíveis.
   * 
   * IMPORTANTE: Esta função não deve bloquear - executa em background.
   */
  const handleExtractionComplete = (runId?: string) => {
    console.log('✅ Extraction completed', runId ? `runId: ${runId}` : '');
    
    // Executar refresh em background (não bloquear)
    // O loading do hook deve ser resetado independentemente deste callback
    (async () => {
      try {
        // IMPORTANTE: Recarregar instâncias primeiro (o backend pode ter criado novas para cardinality="many")
        // Aguardar tempo suficiente para garantir que o backend terminou de criar as instâncias
        // e que o Supabase sincronizou as mudanças no banco
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // 1. Recarregar instâncias (backend pode ter criado novas para cardinality="many")
        if (template) {
          console.log('🔄 Recarregando instâncias após extração...');
          try {
            await refreshInstances();
            console.log('✅ Instâncias recarregadas com sucesso');
          } catch (err) {
            console.error('⚠️ Erro ao recarregar instâncias (não crítico):', err);
            // Não bloquear o fluxo - instâncias serão recarregadas no próximo refresh
          }
        }
        
        // Refresh imediato de valores extraídos
        await refreshValues();
        
        // IMPORTANTE: Aguardar adicional antes de buscar sugestões
        // Isso garante que as instâncias recém-recargadas estejam disponíveis quando buscarmos sugestões
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Polling otimizado: usar resultado direto do refresh ao invés de estado React
        // Isso elimina dependência de estado assíncrono e torna polling mais confiável
        let attempts = 0;
        const maxAttempts = 5; // 5 tentativas = ~5 segundos total (reduzido de 6)
        const pollDelay = 1000; // 1 segundo entre tentativas
        
        // Primeira tentativa (após delays acima)
        console.log('🔄 Recarregando sugestões de IA...');
        let result = await refreshAISuggestions();
        
        // Verificar se há sugestões usando resultado direto (não estado React)
        let foundSuggestions = result.count > 0;
        
        if (foundSuggestions) {
          console.log(`✅ ${result.count} sugestão(ões) encontrada(s) imediatamente`);
          return;
        }
        
        // Continuar polling se não encontramos sugestões
        while (!foundSuggestions && attempts < maxAttempts) {
          attempts++;
          
          console.log(`🔄 Tentativa ${attempts + 1}/${maxAttempts + 1}: Recarregando sugestões...`);
          
          // Aguardar antes de recarregar (dar tempo para backend criar sugestões)
          await new Promise(resolve => setTimeout(resolve, pollDelay));
          
          // Recarregar sugestões e obter resultado diretamente
          result = await refreshAISuggestions();
          
          // Verificar usando resultado direto (mais confiável que estado React)
          foundSuggestions = result.count > 0;
          
          if (foundSuggestions) {
            console.log(`✅ ${result.count} sugestão(ões) encontrada(s) após ${attempts + 1} tentativa(s)`);
            return;
          }
        }
        
        // Se chegamos aqui sem encontrar sugestões
        if (!foundSuggestions) {
          console.log('⚠️ Nenhuma sugestão encontrada após múltiplas tentativas');
          console.log('   Pode ser que:');
          console.log('   - Sugestões não tenham sido criadas (campos já preenchidos, etc)');
          console.log('   - Sugestões foram criadas mas ainda não estão disponíveis no banco');
          console.log('   - Há um problema com o carregamento das sugestões');
        }
      } catch (error) {
        console.error('❌ Erro ao recarregar sugestões:', error);
        // Não mostrar toast de erro - pode ser que sugestões não tenham sido criadas
        // (já tratado pelo hook de extração)
      }
    })(); // IIFE - executar imediatamente sem bloquear
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header Unificado */}
      <ExtractionHeader
        projectId={projectId || ''}
        projectName={project?.name || 'Projeto'}
        articleTitle={article.title}
        onBack={handleBack}
        articles={articles}
        currentArticleId={articleId || ''}
        onNavigateToArticle={handleNavigateToArticle}
        completedFields={completedFields}
        totalFields={totalFields}
        completionPercentage={completionPercentage}
        showPDF={showPDF}
        onTogglePDF={() => setShowPDF(!showPDF)}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        hasOtherExtractions={permissions.canSeeOthers && otherExtractions.length > 0}
        userRole={permissions.userRole}
        isBlindMode={permissions.isBlindMode}
        isSaving={isSaving}
        lastSaved={lastSaved}
        isComplete={isComplete}
        onFinalize={handleFinalize}
        submitting={submitting}
        templateId={template?.id}
        templateName={template?.name}
        onExtractionComplete={handleExtractionComplete}
        aiSuggestions={aiSuggestions}
        onAISuggestionsClick={() => {
          // Scroll para primeira sugestão ou abrir painel
          // Por enquanto, apenas log - pode ser melhorado depois
          console.log('Clicou no badge de IA - scroll para primeira sugestão');
        }}
        template={template}
        instances={instances}
        values={values}
        onRefreshInstances={handleRefreshInstances}
        onExtractionStateChange={setAiExtractionState}
      />

      {/* Progresso de Extração IA - Renderizado no nível da página para evitar conflitos */}
      {(aiExtractionState?.loading && aiExtractionState?.progress) || isProgressMinimized ? (
        <div className="fixed bottom-6 right-6 z-[9999] w-96 max-w-[calc(100vw-3rem)]">
          <FullAIExtractionProgress 
            progress={aiExtractionState?.progress || { stage: 'extracting_models' }}
            onClose={() => {
              setAiExtractionState(null);
              setIsProgressMinimized(false);
            }}
            onMinimize={() => {
              setIsProgressMinimized(true);
            }}
          />
        </div>
      ) : null}

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* PDF Viewer (opcional) - Extraído para componente isolado */}
          <ExtractionPDFPanel 
            articleId={articleId || ''} 
            projectId={projectId || ''} 
            showPDF={showPDF}
          />

          {/* Formulário de extração - Extraído para componente isolado */}
          <ResizablePanel defaultSize={showPDF ? 50 : 100} minSize={30}>
            <ExtractionFormPanel
              viewMode={viewMode}
              showPDF={showPDF}
              formViewProps={{
                studyLevelSections,
                modelParentEntityType,
                modelChildSections,
                instances,
                values,
                updateValue,
                otherExtractions,
                aiSuggestions,
                acceptSuggestion,
                rejectSuggestion,
                getSuggestionsHistory,
                isActionLoading,
                models,
                activeModelId,
                setActiveModelId,
                onAddModel: handleAddModel,
                onRemoveModel: handleRemoveModel,
                onRefreshModels: refreshModels,
                onRefreshInstances: handleRefreshInstances,
                getInstancesForModel,
                handleAddInstance,
                handleRemoveInstance,
                projectId: projectId || '',
                articleId: articleId || '',
                templateId: template?.id || '',
                modelsLoading,
                onExtractionComplete: handleExtractionComplete,
              }}
              compareViewProps={{
                studyLevelSections,
                modelParentEntityType,
                modelChildSections,
                instances,
                values,
                updateValue,
                otherExtractions,
                currentUser: {
                  userId: currentUserId,
                  userName: 'Você', // TODO: Usar nome real do usuário quando disponível
                  isCurrentUser: true
                },
                editable: true,
              }}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Dialogs */}
      <AddModelDialog
        open={showAddModelDialog}
        onConfirm={handleConfirmAddModel}
        onCancel={() => setShowAddModelDialog(false)}
        existingModels={models.map(m => m.modelName)}
      />

      <RemoveModelDialog
        open={!!modelToRemove}
        modelName={modelToRemove?.name || ''}
        hasExtractedData={modelToRemove?.hasData || false}
        extractedFieldsCount={modelToRemove?.fieldsCount || 0}
        onConfirm={handleConfirmRemoveModel}
        onCancel={() => setModelToRemove(null)}
      />
    </div>
  );
}

