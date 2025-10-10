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

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { PDFViewer } from '@/components/PDFViewer';

// Hooks
import { useExtractedValues } from '@/hooks/extraction/useExtractedValues';
import { useExtractionProgress } from '@/hooks/extraction/useExtractionProgress';
import { useExtractionAutoSave } from '@/hooks/extraction/useExtractionAutoSave';
import { useOtherExtractions } from '@/hooks/extraction/colaboracao/useOtherExtractions';
import { useAISuggestions } from '@/hooks/extraction/ai/useAISuggestions';

// Components
import { ExtractionHeader } from '@/components/extraction/ExtractionHeader';
import { SectionAccordion } from '@/components/extraction/SectionAccordion';
import { ComparisonGridView } from '@/components/extraction/colaboracao/ComparisonGridView';

// Types
import type { 
  ProjectExtractionTemplate,
  ExtractionEntityType,
  ExtractionField,
  ExtractionInstance
} from '@/types/extraction';

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

  // Hook para outras extrações (colaboração)
  const { otherExtractions } = useOtherExtractions({
    articleId: articleId || '',
    projectId: projectId || '',
    currentUserId,
    enabled: !!currentUserId
  });

  // Hook para sugestões de IA
  const { suggestions: aiSuggestions, acceptSuggestion, rejectSuggestion } = useAISuggestions({
    articleId: articleId || '',
    projectId: projectId || '',
    enabled: !!articleId && !!projectId
  });

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
        .eq('id', articleId)
        .single();

      if (articleError) throw articleError;
      if (!articleData) throw new Error('Artigo não encontrado');

      setArticle(articleData);
      console.log('✅ Artigo carregado:', articleData.title);

      // 2. Carregar projeto
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();

      if (projectError) throw projectError;
      if (!projectData) throw new Error('Projeto não encontrado');

      setProject(projectData);
      console.log('✅ Projeto carregado:', projectData.name);

      // 3. Carregar lista de artigos do projeto para navegação
      const { data: articlesData, error: articlesError } = await supabase
        .from('articles')
        .select('id, title')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (articlesError) throw articlesError;
      setArticles(articlesData || []);
      console.log('✅ Lista de artigos carregada:', articlesData?.length || 0);

      // 4. Carregar template ativo do projeto
      const { data: templateData, error: templateError } = await supabase
        .from('project_extraction_templates')
        .select('*')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .single();

      if (templateError) throw templateError;
      if (!templateData) throw new Error('Template de extração não configurado');

      setTemplate(templateData);
      console.log('✅ Template carregado:', templateData.name);

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
        fields: et.fields || []
      }));

      setEntityTypes(typesWithFields);
      console.log('✅ Entity types carregados:', typesWithFields.length);

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

      // Buscar instâncias existentes para este artigo
      const { data: existingInstances, error: instancesError } = await supabase
        .from('extraction_instances')
        .select('*')
        .eq('article_id', articleId)
        .eq('template_id', templateId);

      if (instancesError) throw instancesError;

      // Verificar se precisa criar instâncias para novos entity types
      const existingEntityTypeIds = new Set(
        (existingInstances || []).map(i => i.entity_type_id)
      );

      const instancesToCreate: any[] = [];

      entityTypesList.forEach(entityType => {
        if (!existingEntityTypeIds.has(entityType.id)) {
          // Criar instância para este entity type
          instancesToCreate.push({
            project_id: projectId,
            article_id: articleId,
            template_id: templateId,
            entity_type_id: entityType.id,
            label: entityType.label,
            sort_order: entityType.sort_order,
            is_template: false,
            status: 'pending',
            created_by: user.id,
            metadata: {}
          });
        }
      });

      // Criar instâncias faltantes
      if (instancesToCreate.length > 0) {
        const { data: newInstances, error: createError } = await supabase
          .from('extraction_instances')
          .insert(instancesToCreate)
          .select();

        if (createError) throw createError;

        console.log(`✅ Criadas ${newInstances?.length} novas instâncias`);

        // Combinar existentes + novas
        setInstances([...(existingInstances || []), ...(newInstances || [])]);
      } else {
        setInstances(existingInstances || []);
      }

      console.log('✅ Instâncias carregadas/criadas:', 
        (existingInstances?.length || 0) + instancesToCreate.length);

    } catch (error: any) {
      console.error('❌ Erro ao carregar/criar instâncias:', error);
      throw error;
    }
  };

  const handleBack = () => {
    navigate(`/projects/${projectId}?tab=extraction`);
  };

  const handleNavigateToArticle = (newArticleId: string) => {
    navigate(`/projects/${projectId}/extraction/${newArticleId}`);
  };

  const handleAddInstance = async (entityTypeId: string) => {
    if (!template) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      // Encontrar entity type
      const entityType = entityTypes.find(et => et.id === entityTypeId);
      if (!entityType) return;

      // Contar instâncias existentes para gerar label
      const existingCount = instances.filter(i => i.entity_type_id === entityTypeId).length;
      const newLabel = `${entityType.label} ${existingCount + 1}`;

      // Criar nova instância
      const { data: newInstance, error } = await supabase
        .from('extraction_instances')
        .insert({
          project_id: projectId,
          article_id: articleId,
          template_id: template.id,
          entity_type_id: entityTypeId,
          label: newLabel,
          sort_order: existingCount,
          is_template: false,
          status: 'pending',
          created_by: user.id,
          metadata: {}
        })
        .select()
        .single();

      if (error) throw error;

      // Atualizar estado local
      setInstances(prev => [...prev, newInstance]);
      toast.success(`${newLabel} adicionado com sucesso`);

    } catch (error: any) {
      console.error('Erro ao adicionar instância:', error);
      toast.error('Erro ao adicionar instância');
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
        .eq('article_id', articleId)
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
  if (!article || !template || entityTypes.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-destructive">Erro ao carregar dados</p>
          <Button onClick={handleBack}>Voltar</Button>
        </div>
      </div>
    );
  }

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
        hasOtherExtractions={otherExtractions.length > 0}
        isSaving={isSaving}
        lastSaved={lastSaved}
        isComplete={isComplete}
        onFinalize={handleFinalize}
        submitting={submitting}
      />

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* PDF Viewer (opcional) */}
          {showPDF && (
            <>
              <ResizablePanel defaultSize={50} minSize={30} maxSize={70}>
                <div className="h-full">
                  <PDFViewer articleId={articleId || ''} projectId={projectId || ''} />
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}

          {/* Formulário de extração */}
          <ResizablePanel defaultSize={showPDF ? 50 : 100} minSize={30}>
            <ScrollArea className="h-full bg-slate-50">
              <div className="p-8 space-y-4">
                {viewMode === 'extract' ? (
                  // Modo extração: Accordion por seção
                  entityTypes.map(entityType => {
                    // Buscar instâncias deste entity type
                    const typeInstances = instances.filter(
                      i => i.entity_type_id === entityType.id
                    );

                    return (
                      <SectionAccordion
                        key={entityType.id}
                        entityType={entityType}
                        instances={typeInstances}
                        fields={entityType.fields}
                        values={values}
                        onValueChange={updateValue}
                        projectId={projectId || ''}
                        articleId={articleId || ''}
                        otherExtractions={otherExtractions}
                        aiSuggestions={aiSuggestions}
                        onAcceptAI={acceptSuggestion}
                        onRejectAI={rejectSuggestion}
                        onAddInstance={() => handleAddInstance(entityType.id)}
                        onRemoveInstance={handleRemoveInstance}
                      />
                    );
                  })
                ) : (
                  // Modo comparação: Grid completo por seção
                  <div className="space-y-6">
                    {entityTypes.map(entityType => {
                      const typeInstances = instances.filter(
                        i => i.entity_type_id === entityType.id
                      );

                      return (
                        <div key={entityType.id} className="space-y-3">
                          <div className="flex items-center gap-3">
                            <h3 className="text-lg font-semibold">{entityType.label}</h3>
                            {entityType.cardinality === 'many' && (
                              <Badge variant="outline">Múltipla</Badge>
                            )}
                          </div>

                          {typeInstances.map(instance => {
                            // Preparar valores desta instância
                            const instanceValues: Record<string, any> = {};
                            entityType.fields.forEach(field => {
                              const key = `${instance.id}_${field.id}`;
                              instanceValues[field.id] = values[key];
                            });

                            return (
                              <div key={instance.id}>
                                {entityType.cardinality === 'many' && (
                                  <p className="text-sm text-muted-foreground mb-2">
                                    {instance.label}
                                  </p>
                                )}
                                <ComparisonGridView
                                  fields={entityType.fields}
                                  instanceId={instance.id}
                                  myValues={instanceValues}
                                  otherExtractions={otherExtractions}
                                />
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </ScrollArea>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

