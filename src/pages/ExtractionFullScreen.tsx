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

import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { extractionInstanceService } from '@/services/extractionInstanceService';
import { extractionLogger } from '@/lib/extraction/observability';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { PDFViewer } from '@/components/PDFViewer';

// Hooks
import { useExtractedValues } from '@/hooks/extraction/useExtractedValues';
import { useExtractionProgress } from '@/hooks/extraction/useExtractionProgress';
import { useExtractionAutoSave } from '@/hooks/extraction/useExtractionAutoSave';
import { useOtherExtractions } from '@/hooks/extraction/colaboracao/useOtherExtractions';
import { useAISuggestions } from '@/hooks/extraction/ai/useAISuggestions';
import { useComparisonPermissions } from '@/hooks/shared/useComparisonPermissions';
import { getTemplateDebugInfo, logTemplateDebug } from '@/lib/template-helpers';

// Components
import { ExtractionHeader } from '@/components/extraction/ExtractionHeader';
import { ExtractionFormView } from '@/components/extraction/ExtractionFormView';
import { ExtractionCompareView } from '@/components/extraction/ExtractionCompareView';
import { AddModelDialog, RemoveModelDialog } from '@/components/extraction/hierarchy';

// Hooks adicionais
import { useModelManagement } from '@/hooks/extraction/useModelManagement';

// Types
import type { 
  ProjectExtractionTemplate,
  ExtractionEntityType,
  ExtractionField,
  ExtractionInstance
} from '@/types/extraction';

// =================== MEMOIZATION ===================

/**
 * PDFViewer memoizado para evitar re-renders desnecessários
 * Causa do bug: Auto-save causa re-render que re-cria PDFViewer
 */
const MemoizedPDFViewer = memo(PDFViewer, (prevProps, nextProps) => {
  return prevProps.articleId === nextProps.articleId && 
         prevProps.projectId === nextProps.projectId;
});

MemoizedPDFViewer.displayName = 'MemoizedPDFViewer';

// =================== INTERFACES ===================

interface EntityTypeWithFields extends ExtractionEntityType {
  fields: ExtractionField[];
}

// =================== COMPONENT ===================

export default function ExtractionFullScreen() {
  const { projectId, articleId } = useParams();
  const navigate = useNavigate();

  // Estado principal
  const [article, setArticle] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [template, setTemplate] = useState<ProjectExtractionTemplate | null>(null);
  const [entityTypes, setEntityTypes] = useState<EntityTypeWithFields[]>([]);
  const [instances, setInstances] = useState<ExtractionInstance[]>([]);
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');

  // UI state
  const [showPDF, setShowPDF] = useState(true);
  const [viewMode, setViewMode] = useState<'extract' | 'compare'>('extract');
  
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
    save: saveValues
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

  // Hook para sugestões de IA com callback para preencher campo automaticamente
  const handleAISuggestionAccepted = useCallback((instanceId: string, fieldId: string, value: any) => {
    // Preencher o campo automaticamente quando sugestão é aceita
    console.log('🤖 Aceitando sugestão de IA:', { instanceId, fieldId, value });
    updateValue(instanceId, fieldId, value);
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
    onSuggestionAccepted: handleAISuggestionAccepted
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

  // Carregar dados iniciais
  useEffect(() => {
    if (!projectId || !articleId) {
      toast.error('Parâmetros inválidos');
      navigate('/');
      return;
    }

    loadInitialData();
  }, [projectId, articleId]);

  const loadInitialData = async () => {
    setLoading(true);

    try {
      console.log('📥 Carregando dados para extração...');

      // 0. Carregar usuário atual
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');
      setCurrentUserId(user.id);

      // 1. Carregar artigo
      const { data: articleData, error: articleError } = await supabase
        .from('articles')
        .select('*')
        .eq('id', articleId!)
        .single();

      if (articleError) throw articleError;
      if (!articleData) throw new Error('Artigo não encontrado');

      setArticle(articleData);
      console.log('✅ Artigo carregado:', articleData.title);

      // 2. Carregar projeto
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId!)
        .single();

      if (projectError) throw projectError;
      if (!projectData) throw new Error('Projeto não encontrado');

      setProject(projectData);
      console.log('✅ Projeto carregado:', projectData.name);

      // 3. Carregar lista de artigos do projeto para navegação
      const { data: articlesData, error: articlesError } = await supabase
        .from('articles')
        .select('id, title')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: false });

      if (articlesError) throw articlesError;
      setArticles(articlesData || []);
      console.log('✅ Lista de artigos carregada:', articlesData?.length || 0);

      // 4. Carregar template ativo do projeto
      const { data: templateData, error: templateError } = await supabase
        .from('project_extraction_templates')
        .select('*')
        .eq('project_id', projectId!)
        .eq('is_active', true)
        .single();

      if (templateError) throw templateError;
      if (!templateData) throw new Error('Template de extração não configurado');

      setTemplate(templateData);
      console.log('✅ Template carregado:', templateData.name);

      // Debug: Validar template e obter informações detalhadas
      logTemplateDebug('ExtractionFullScreen', templateData.id, {
        templateName: templateData.name,
        framework: templateData.framework,
        version: templateData.version
      });

      const debugInfo = await getTemplateDebugInfo(templateData.id);
      if (debugInfo.error) {
        console.warn('⚠️ Erro no debug do template:', debugInfo.error);
      } else {
        console.log('🔍 Debug Template:', {
          name: debugInfo.templateInfo?.name,
          entityTypesCount: debugInfo.entityTypesCount,
          fieldsCount: debugInfo.fieldsCount,
          isActive: debugInfo.templateInfo?.is_active,
          globalTemplate: debugInfo.templateInfo?.globalTemplateName
        });
      }

      // 5. Carregar entity types com seus campos
      const { data: entityTypesData, error: entityTypesError } = await supabase
        .from('extraction_entity_types')
        .select(`
          *,
          fields:extraction_fields(*)
        `)
        .eq('project_template_id', templateData.id)
        .order('sort_order', { ascending: true });

      if (entityTypesError) throw entityTypesError;

      const typesWithFields: EntityTypeWithFields[] = (entityTypesData || []).map(et => ({
        ...et,
        template_id: et.template_id!,
        fields: (et.fields || []).map(field => ({
          ...field,
          allowed_values: field.allowed_values as string[] | null,
          allowed_units: field.allowed_units as string[] | null,
          validation_schema: field.validation_schema as any
        }))
      }));

      setEntityTypes(typesWithFields);
      
      // Log estruturado dos entity types carregados
      console.log('✅ Entity types carregados:', {
        total: typesWithFields.length,
        rootTypes: typesWithFields.filter(et => !et.parent_entity_type_id).length,
        childTypes: typesWithFields.filter(et => et.parent_entity_type_id).length,
        hierarchy: typesWithFields.map(et => ({
          id: et.id,
          name: et.name,
          label: et.label,
          parent: et.parent_entity_type_id,
          fieldsCount: et.fields.length
        }))
      });

      // 6. Carregar ou criar instâncias para este artigo
      await loadOrCreateInstances(templateData.id, typesWithFields);

    } catch (error: any) {
      console.error('❌ Erro ao carregar dados:', error);
      toast.error(`Erro ao carregar dados: ${error.message}`);
      navigate(`/projects/${projectId}`);
    } finally {
      setLoading(false);
    }
  };

  const loadOrCreateInstances = async (
    templateId: string,
    entityTypesList: EntityTypeWithFields[]
  ) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      // Delegar para o service (inicialização automática)
      const instances = await extractionInstanceService.initializeArticleInstances(
        articleId!,
        projectId!,
        { id: templateId } as any,
        entityTypesList,
        user.id
      );

      setInstances(instances.map(instance => ({
        ...instance,
        article_id: instance.article_id!,
        metadata: instance.metadata as any
      })));

      console.log('✅ Instâncias inicializadas:', instances.length);

    } catch (error: any) {
      console.error('❌ Erro ao carregar/criar instâncias:', error);
      throw error;
    }
  };

  // Função para recarregar instâncias (usada após extração de modelos)
  const handleRefreshInstances = useCallback(async () => {
    if (!template) return;
    
    try {
      console.log('🔄 Recarregando instâncias...');
      const refreshedInstances = await extractionInstanceService.getInstances({
        articleId: articleId!,
        templateId: template.id
      });
      
      setInstances(refreshedInstances.map(instance => ({
        ...instance,
        article_id: instance.article_id!,
        metadata: instance.metadata as any
      })));
      
      console.log(`✅ ${refreshedInstances.length} instância(s) recarregada(s)`);
    } catch (error: any) {
      console.error('❌ Erro ao recarregar instâncias:', error);
      throw error;
    }
  }, [template, articleId]);

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
      
      // ✅ OTIMIZAÇÃO: Atualizar estado local DIRETAMENTE com child instances retornadas
      // Evita query extra de loadOrCreateInstances()
      if (result.childInstances && result.childInstances.length > 0) {
        console.log(`🚀 Adicionando ${result.childInstances.length} child instances ao estado local`);
        setInstances(prev => [...prev, ...result.childInstances.map((instance: any) => ({
          ...instance,
          article_id: instance.article_id!,
          metadata: instance.metadata as any
        }))]);
      }
      
      // Atualizar lista de modelos (apenas 1 query necessária)
      await refreshModels();
      
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
      
      // ✅ MELHORIA: Usar try/catch em vez de verificar boolean
      // Isso permite que o modal capture e trate erros adequadamente
      await removeModel(modelIdToRemove);
      
      extractionLogger.info('removeModelHandler', 'Modelo removido com sucesso', {
        modelId: modelIdToRemove,
        modelName: modelToRemove.name
      });

      setModelToRemove(null);
      
      // ✅ OTIMIZAÇÃO: Atualizar estado local DIRETAMENTE (sem query pesada)
      // Remover todas as instances relacionadas ao modelo (parent + children)
      setInstances(prev => prev.filter(
        instance => {
          // Manter instances que NÃO são do modelo removido
          // Remove parent instance E child instances (que têm parent_instance_id)
          return instance.id !== modelIdToRemove && 
                 instance.parent_instance_id !== modelIdToRemove;
        }
      ));
      
      // Atualizar lista de modelos (apenas 1 query necessária)
      await refreshModels();
      
      extractionLogger.info('removeModelHandler', 'Estado atualizado, modelo removido da interface', {
        modelId: modelIdToRemove,
        instancesRemoved: instances.filter(i => 
          i.id === modelIdToRemove || i.parent_instance_id === modelIdToRemove
        ).length
      });
      
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
        // Atualizar estado local
        setInstances(prev => [...prev, result.instance]);
        
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

      // Atualizar estado local
      setInstances(prev => prev.filter(i => i.id !== instanceId));
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

    setSubmitting(true);

    try {
      // Salvar valores pendentes
      await saveValues();

      // Atualizar status das instâncias
      const { error } = await supabase
        .from('extraction_instances')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('article_id', articleId!)
        .in('id', instances.map(i => i.id));

      if (error) throw error;

      toast.success('Extração finalizada com sucesso!');
      handleBack();

    } catch (error: any) {
      console.error('Erro ao finalizar:', error);
      toast.error('Erro ao finalizar extração');
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
        
        if (template) {
          console.log('🔄 Recarregando instâncias após extração...');
          try {
            const refreshedInstances = await extractionInstanceService.getInstances({
              articleId: articleId!,
              templateId: template.id
            });
            
            setInstances(refreshedInstances.map(instance => ({
              ...instance,
              article_id: instance.article_id!,
              metadata: instance.metadata as any
            })));
            
            console.log(`✅ ${refreshedInstances.length} instância(s) recarregada(s)`);
          } catch (err) {
            console.error('⚠️ Erro ao recarregar instâncias (não crítico):', err);
            // Não bloquear o fluxo - instâncias serão recarregadas no próximo refresh da página
          }
        }
        
        // Refresh imediato de valores extraídos
        await values.refresh();
        
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
          toast.success(`${result.count} sugestão(ões) de IA disponível(is). Revise os campos com badge ⚡`);
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
            toast.success(`${result.count} sugestão(ões) de IA disponível(is). Revise os campos com badge ⚡`);
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
      />

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* PDF Viewer (opcional) - Memoizado para evitar re-renders */}
          {showPDF && (
            <>
              <ResizablePanel defaultSize={50} minSize={30} maxSize={70}>
                <MemoizedPDFViewer articleId={articleId || ''} projectId={projectId || ''} />
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}

          {/* Formulário de extração */}
          <ResizablePanel defaultSize={showPDF ? 50 : 100} minSize={30}>
            <ScrollArea className="h-full bg-slate-50">
              <div className="p-8 space-y-4">
                {viewMode === 'extract' ? (
                  <ExtractionFormView
                    studyLevelSections={studyLevelSections}
                    modelParentEntityType={modelParentEntityType}
                    modelChildSections={modelChildSections}
                    instances={instances}
                    values={values}
                    updateValue={updateValue}
                    otherExtractions={otherExtractions}
                    aiSuggestions={aiSuggestions}
                    acceptSuggestion={acceptSuggestion}
                    rejectSuggestion={rejectSuggestion}
                    getSuggestionsHistory={getSuggestionsHistory}
                    isActionLoading={isActionLoading}
                    models={models}
                    activeModelId={activeModelId}
                    setActiveModelId={setActiveModelId}
                    onAddModel={handleAddModel}
                    onRemoveModel={handleRemoveModel}
                    onRefreshModels={refreshModels}
                    onRefreshInstances={handleRefreshInstances}
                    getInstancesForModel={getInstancesForModel}
                    handleAddInstance={handleAddInstance}
                    handleRemoveInstance={handleRemoveInstance}
                    projectId={projectId || ''}
                    articleId={articleId || ''}
                    templateId={template?.id || ''}
                    modelsLoading={modelsLoading}
                    onExtractionComplete={handleExtractionComplete}
                  />
                ) : (
                  <ExtractionCompareView
                    studyLevelSections={studyLevelSections}
                    modelParentEntityType={modelParentEntityType}
                    modelChildSections={modelChildSections}
                    instances={instances}
                    values={values}
                    updateValue={updateValue}
                    otherExtractions={otherExtractions}
                    currentUser={{
                      userId: currentUserId,
                      userName: article?.created_by?.full_name || 'Você',
                      isCurrentUser: true
                    }}
                    editable={true}
                  />
                )}
              </div>
            </ScrollArea>
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

