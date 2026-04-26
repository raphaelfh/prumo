/**
 * Full-screen data extraction interface
 *
 * Main page where the user extracts data from a specific article.
 * Uses full-screen layout with PDF viewer beside extraction form.
 *
 * Features:
 * - PDF viewer with toggle
 * - Section-based extraction form
 * - Automatic auto-save
 * - Multi-user collaboration (popover + grid)
 * - AI suggestions (prefill + badge)
 * - Progress tracking
 *
 * @page
 */

import {useCallback, useEffect, useMemo, useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {toast} from 'sonner';
import {supabase} from '@/integrations/supabase/client';
import {extractionInstanceService} from '@/services/extractionInstanceService';
import {extractionLogger} from '@/lib/extraction/observability';
import {errorTracker} from '@/services/errorTracking';
import {ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable';
import {Button} from '@/components/ui/button';
import {Loader2} from 'lucide-react';

// Hooks
import {useExtractionData} from '@/hooks/extraction/useExtractionData';
import {useExtractedValues} from '@/hooks/extraction/useExtractedValues';
import {useExtractionProgress} from '@/hooks/extraction/useExtractionProgress';
import {useExtractionAutoSave} from '@/hooks/extraction/useExtractionAutoSave';
import {useOtherExtractions} from '@/hooks/extraction/colaboracao/useOtherExtractions';
import {useAISuggestions} from '@/hooks/extraction/ai/useAISuggestions';
import {useComparisonPermissions} from '@/hooks/shared/useComparisonPermissions';

// Components
import {ExtractionHeader} from '@/components/extraction/ExtractionHeader';
import {ExtractionPDFPanel} from '@/components/extraction/ExtractionPDFPanel';
import {ExtractionFormPanel} from '@/components/extraction/ExtractionFormPanel';
import {AddModelDialog, RemoveModelDialog} from '@/components/extraction/hierarchy';
import {FullAIExtractionProgress} from '@/components/extraction/FullAIExtractionProgress';

// Hooks adicionais
import {useModelManagement} from '@/hooks/extraction/useModelManagement';
import {t} from '@/lib/copy';

// =================== COMPONENT ===================

export default function ExtractionFullScreen() {
  const { projectId, articleId } = useParams();
  const navigate = useNavigate();

    // Load data using dedicated hook (SRP: separation of concerns)
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

    // AI extraction progress state
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

    // Hook to manage extracted values
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

    // Auto-save hook (only enable after values initialized)
  const { isSaving, lastSaved } = useExtractionAutoSave({
    articleId: articleId || '',
    projectId: projectId || '',
    values,
    enabled: !!articleId && !!projectId && !loading && valuesInitialized
  });

    // Permissions hook (controls comparison access)
  const permissions = useComparisonPermissions(
    projectId || '',
    currentUserId
  );

    // Hook for other extractions (collaboration) - controlled by permissions
  const { otherExtractions } = useOtherExtractions({
    articleId: articleId || '',
    projectId: projectId || '',
    currentUserId,
    enabled: permissions.canSeeOthers && !!currentUserId
  });

    // Hook for AI suggestions with callbacks to fill/clear field
  const handleAISuggestionAccepted = useCallback(async (instanceId: string, fieldId: string, value: any) => {
      // Fill field automatically when suggestion is accepted
      console.warn('Accepting AI suggestion:', {instanceId, fieldId, value});
      // updateValue updates local state immediately
      // AISuggestionService.acceptSuggestion already saves to DB
      // No need to reload all values (refreshValues caused full page reload)
    updateValue(instanceId, fieldId, value);
  }, [updateValue]);

  const handleAISuggestionRejected = useCallback(async (instanceId: string, fieldId: string) => {
      // Clear field when suggestion is rejected
      console.warn('Rejecting AI suggestion - clearing field:', {instanceId, fieldId});
      // updateValue updates local state immediately
      // AISuggestionService.rejectSuggestion already updates status in DB
      // No need to reload all values (refreshValues caused full page reload)
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

    // Persist active model in localStorage
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

    // Memoize instance filter function (avoids recreating it)
  const getInstancesForModel = useCallback((entityTypeId: string, modelId: string) => {
    return instances.filter(
      i => i.entity_type_id === entityTypeId && i.parent_instance_id === modelId
    );
  }, [instances]);

    // Removed: SectionAccordion does not need memo, FieldInput is memoized individually

    // Load current user
  useEffect(() => {
    const loadUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
      }
    };
    loadUser();
  }, []);

    // Redirect on critical error
  useEffect(() => {
    if (dataError && projectId) {
      toast.error(dataError);
      navigate(`/projects/${projectId}?tab=extraction`);
    }
  }, [dataError, projectId, navigate]);

    // Function to reload instances (used after model extraction)
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
      console.warn('Starting model creation:', modelName);
    const result = await createModel(modelName, modellingMethod);
    
    if (result) {
        console.warn('Model created successfully:', result.model);
      setShowAddModelDialog(false);

        // Reload instances only (child instances will be included)
        // Do not call refreshModels() - hook already updates local state
      await refreshInstances();

        console.warn('State updated, fields should appear immediately');
    }
  };

  const handleRemoveModel = async (instanceId: string) => {
    const model = models.find(m => m.instanceId === instanceId);
    if (!model) return;

      // Check if there is extracted data
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
        extractionLogger.info('removeModelHandler', 'Starting model removal', {
        modelId: modelToRemove.id,
        modelName: modelToRemove.name,
        hasData: modelToRemove.hasData,
        fieldsCount: modelToRemove.fieldsCount
      });

      const modelIdToRemove = modelToRemove.id;

        // Remove model (already updates local state)
      await removeModel(modelIdToRemove);

        extractionLogger.info('removeModelHandler', 'Model removed successfully', {
        modelId: modelIdToRemove,
        modelName: modelToRemove.name
      });

        // Close dialog immediately after successful removal
      setModelToRemove(null);

        // Do not call refreshModels() - hook already updates local state
        // Only reload instances so child instances are removed from UI
      try {
        await refreshInstances();
          extractionLogger.info('removeModelHandler', 'State updated, model removed from UI', {
          modelId: modelIdToRemove,
          instancesRemoved: instances.filter(i => 
            i.id === modelIdToRemove || i.parent_instance_id === modelIdToRemove
          ).length
        });
      } catch (refreshError: any) {
          // Log error but do not re-throw - model was already removed successfully
          extractionLogger.error('removeModelHandler', 'Error reloading instances after removal', refreshError, {
          modelId: modelIdToRemove
        });
          // Do not block flow - model was already removed from local state
      }
      
    } catch (error: any) {
      // ✅ Re-throw para o modal capturar e exibir erro
        extractionLogger.error('removeModelHandler', 'Failed to remove model', error, {
        modelId: modelToRemove.id,
        modelName: modelToRemove.name
      });
      throw error;
    }
  };

  const handleAddInstance = async (entityTypeId: string) => {
    if (!template) return;

    try {
        extractionLogger.info('handleAddInstance', 'Starting instance creation', {
        entityTypeId,
        templateId: template.id
      });

      const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error(t('common', 'errors_userNotAuthenticated'));

      // Encontrar entity type
      const entityType = entityTypes.find(et => et.id === entityTypeId);
      if (!entityType) {
          extractionLogger.warn('handleAddInstance', 'Entity type not found', {entityTypeId});
        return;
      }

        // Determine parent_instance_id if hierarchical entity type
      let parentInstanceId: string | undefined = undefined;

        // If it has parent_entity_type_id, it is a child entity (e.g. model child sections)
      if (entityType.parent_entity_type_id) {
          // If parent is prediction_models, use activeModelId
        if (entityType.parent_entity_type_id === modelParentEntityType?.id) {
          if (!activeModelId) {
              toast.error(t('pages', 'extractionScreenSelectModelFirst'));
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
              toast.error(t('pages', 'extractionScreenParentNotFound'));
            return;
          }
        }
      }

        // Count existing instances to generate label (same parent)
      const existingCount = instances.filter(i => 
        i.entity_type_id === entityTypeId && 
        i.parent_instance_id === (parentInstanceId || null)
      ).length;

        // Generate unique label
      let newLabel: string;
      if (parentInstanceId) {
          // For child instances, include parent reference to avoid conflicts
        const parentInstance = instances.find(i => i.id === parentInstanceId);
        newLabel = parentInstance 
          ? `${parentInstance.label} - ${entityType.label} ${existingCount + 1}`
          : `${entityType.label} ${existingCount + 1}`;
      } else {
        newLabel = `${entityType.label} ${existingCount + 1}`;
      }

        extractionLogger.debug('handleAddInstance', 'Creating instance via service', {
        entityTypeId,
        entityTypeName: entityType.name,
        parentInstanceId,
        label: newLabel
      });

      // ✅ MELHORIA: Usar service layer em vez de INSERT direto
        // Ensures validations, logs and consistency
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
          // Reload instances after create
        await refreshInstances();

          extractionLogger.info('handleAddInstance', 'Instance created successfully', {
          instanceId: result.instance.id,
          label: result.instance.label
        });

          toast.success(`${result.instance.label} ${t('pages', 'extractionScreenInstanceAddedSuccess')}`);
      } else {
          extractionLogger.info('handleAddInstance', 'Instance already existed', {
          instanceId: result.instance.id,
          label: result.instance.label
        });

          toast.info(t('pages', 'extractionScreenInstanceAlreadyExists'));
      }

    } catch (error: any) {
        extractionLogger.error('handleAddInstance', 'Failed to create instance', error, {
        entityTypeId,
        templateId: template.id
      });

        console.error('Error adding instance:', error);
        toast.error(`${t('pages', 'extractionScreenErrorAddInstance')}: ${error.message}`);
    }
  };

  const handleRemoveInstance = async (instanceId: string) => {
    try {
        // Check if there are extracted values
      const hasValues = Object.keys(values).some(key => key.startsWith(`${instanceId}_`));

      if (hasValues) {
          const confirmed = window.confirm(t('pages', 'extractionScreenConfirmRemoveInstance'));
        if (!confirmed) return;
      }

      const { error } = await supabase
        .from('extraction_instances')
        .delete()
        .eq('id', instanceId);

      if (error) throw error;

        // Reload instances after remove
      await refreshInstances();
        toast.success(t('pages', 'extractionScreenInstanceRemoved'));

    } catch (error: any) {
        console.error('Error removing instance:', error);
        toast.error(t('pages', 'extractionScreenErrorRemoveInstance'));
    }
  };

  const handleFinalize = async () => {
    if (!isComplete) {
        toast.error(t('pages', 'extractionScreenCompleteRequiredFields'));
      return;
    }

      // Validate required data
    if (!articleId || !projectId) {
        extractionLogger.error('handleFinalize', 'Incomplete data to finalize extraction', undefined, {
        articleId,
        projectId
      });
        toast.error(t('pages', 'extractionScreenErrorArticleNotFound'));
      return;
    }

      // Validate that there are instances to update
    if (!instances || instances.length === 0) {
        extractionLogger.warn('handleFinalize', 'No instances found to finalize', {
        articleId,
        projectId
      });
        toast.error(t('pages', 'extractionScreenErrorNoInstances'));
      return;
    }

    setSubmitting(true);

    const logger = extractionLogger;
      logger.info('handleFinalize', 'Starting extraction finalization', {
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

          throw new Error(`${t('extraction', 'errors_saveValues')}: ${saveError.message || t('common', 'errors_unknownError')}`);
      }

        // 2. Update instance statuses
      const instanceIds = instances.map(i => i.id);
        logger.debug('handleFinalize', 'Updating instance statuses...', {
        instanceIds,
        instancesCount: instanceIds.length
      });

      const { error: updateError, data: updatedData } = await supabase
        .from('extraction_instances')
        .update({
          status: 'completed'
            // Removed: completed_at does not exist on extraction_instances table
          // (existe apenas em extraction_runs)
        })
        .eq('article_id', articleId)
        .in('id', instanceIds)
          .select('id, status'); // Return data to confirm update

      if (updateError) {
          logger.error('handleFinalize', 'Error updating instance statuses', updateError as Error, {
          errorCode: updateError.code,
          errorMessage: updateError.message,
          errorDetails: updateError.details,
          instanceIds,
          articleId
        });

        errorTracker.captureError(
            new Error(updateError.message || 'Error updating instance statuses'),
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

          // More specific error message based on error code
          let errorMessage = t('pages', 'extractionScreenErrorUpdateStatus');
        if (updateError.code === 'PGRST301' || updateError.message.includes('permission denied')) {
            errorMessage = t('pages', 'extractionScreenErrorPermission');
        } else if (updateError.code === '23503' || updateError.message.includes('foreign key')) {
            errorMessage = t('pages', 'extractionScreenErrorRelatedData');
        } else if (updateError.message) {
            errorMessage = `Error: ${updateError.message}`;
        }

        throw new Error(errorMessage);
      }

        // Confirm instances were updated
      const updatedCount = updatedData?.length || 0;
      if (updatedCount === 0) {
          logger.warn('handleFinalize', 'No instances were updated', {
          instanceIds,
          articleId
        });
          throw new Error(t('pages', 'extractionScreenNoInstanceUpdated'));
      }

      if (updatedCount < instanceIds.length) {
          logger.warn('handleFinalize', 'Some instances were not updated', {
          expected: instanceIds.length,
          actual: updatedCount,
          instanceIds
        });
      }

        logger.info('handleFinalize', 'Extraction finalized successfully', {
        articleId,
        instancesUpdated: updatedCount,
        totalInstances: instanceIds.length
      });

        toast.success(t('pages', 'extractionScreenFinalizeSuccess'));
      handleBack();

    } catch (error: any) {
        // Error already logged and caught above, just show message to user
        const errorMessage = error instanceof Error
            ? error.message
            : (error?.message || t('pages', 'extractionScreenErrorFinalizeUnknown'));

        logger.error('handleFinalize', 'Failed to finalize extraction', error instanceof Error ? error : new Error(errorMessage), {
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
            <p className="text-muted-foreground">{t('pages', 'extractionScreenLoading')}</p>
        </div>
      </div>
    );
  }

  // Error state
  if (!article || !template) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
            <p className="text-destructive">{t('pages', 'extractionScreenErrorLoad')}</p>
            <Button onClick={handleBack}>{t('common', 'back')}</Button>
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
              <h3 className="text-lg font-semibold">{t('pages', 'extractionScreenNoFieldsTitle')}</h3>
            <p className="text-muted-foreground">
                {t('pages', 'extractionScreenNoFieldsDesc')}
            </p>
          </div>
          
          <div className="bg-muted/50 p-4 rounded-lg space-y-2 text-sm">
              <p className="font-medium">{t('pages', 'extractionScreenToResolve')}</p>
            <ul className="text-left space-y-1 text-muted-foreground">
                <li>• {t('pages', 'extractionScreenContactManager')}</li>
                <li>• {t('pages', 'extractionScreenRequestConfig')}</li>
                <li>• {t('pages', 'extractionScreenOrConfigureTemplate')}</li>
            </ul>
          </div>

            <Button onClick={handleBack}>{t('common', 'back')}</Button>
        </div>
      </div>
    );
  }

  /**
   * Handler called after section extraction completes
   *
   * Refreshes suggestions and extracted values in background.
   * Uses polling to ensure suggestions are loaded when available.
   *
   * IMPORTANT: This function must not block - runs in background.
   */
  const handleExtractionComplete = (runId?: string) => {
      console.warn('✅ Extraction completed', runId ? `runId: ${runId}` : '');

      // Run refresh in background (do not block)
      // Hook loading should be reset regardless of this callback
    (async () => {
      try {
          // IMPORTANT: Reload instances first (backend may have created new ones for cardinality="many")
          // Wait long enough for backend to finish creating instances
          // and that Supabase synced changes to the DB
        await new Promise(resolve => setTimeout(resolve, 1500));

          // 1. Reload instances (backend may have created new ones for cardinality="many")
        if (template) {
            console.warn('Reloading instances after extraction...');
          try {
            await refreshInstances();
              console.warn('Instances reloaded successfully');
          } catch (err) {
              console.error('Error reloading instances (non-critical):', err);
              // Do not block flow - instances will be reloaded on next refresh
          }
        }

          // Immediate refresh of extracted values
        await refreshValues();

          // IMPORTANT: Wait longer before fetching suggestions
          // Ensures newly reloaded instances are available when we fetch suggestions
        await new Promise(resolve => setTimeout(resolve, 500));

          // Optimized polling: use refresh result directly instead of React state
          // Removes async state dependency and makes polling more reliable
        let attempts = 0;
          const maxAttempts = 5; // 5 attempts = ~5 seconds total
        const pollDelay = 1000; // 1 segundo entre tentativas

          // First attempt (after delays above)
          console.warn('Reloading AI suggestions...');
        let result = await refreshAISuggestions();

          // Check for suggestions using direct result (not React state)
        let foundSuggestions = result.count > 0;
        
        if (foundSuggestions) {
            console.warn(`${result.count} suggestion(s) found immediately`);
          return;
        }

          // Continue polling if we did not find suggestions
        while (!foundSuggestions && attempts < maxAttempts) {
          attempts++;

            console.warn(`Attempt ${attempts + 1}/${maxAttempts + 1}: Reloading suggestions...`);

            // Wait before reload (give backend time to create suggestions)
          await new Promise(resolve => setTimeout(resolve, pollDelay));

            // Reload suggestions and get result directly
          result = await refreshAISuggestions();

            // Check using direct result (more reliable than React state)
          foundSuggestions = result.count > 0;
          
          if (foundSuggestions) {
              console.warn(`${result.count} suggestion(s) found after ${attempts + 1} attempt(s)`);
            return;
          }
        }

          // If we got here without finding suggestions
        if (!foundSuggestions) {
            console.warn('No suggestions found after multiple attempts');
            console.warn('   Possible reasons:');
            console.warn('   - Suggestions were not created (fields already filled, etc)');
            console.warn('   - Suggestions were created but not yet available in the database');
            console.warn('   - There is an issue loading suggestions');
        }
      } catch (error) {
          console.error('Error reloading suggestions:', error);
          // Do not show error toast - suggestions may not have been created
          // (already handled by extraction hook)
      }
    })(); // IIFE - executar imediatamente sem bloquear
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header Unificado */}
      <ExtractionHeader
        projectId={projectId || ''}
        projectName={project?.name || t('pages', 'extractionScreenProjectFallback')}
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
            // Scroll to first suggestion or open panel
          // Por enquanto, apenas log - pode ser melhorado depois
            console.warn('Clicked AI badge - scrolling to first suggestion');
        }}
        template={template}
        instances={instances}
        values={values}
        onRefreshInstances={handleRefreshInstances}
        onExtractionStateChange={setAiExtractionState}
      />

        {/* AI extraction progress - Rendered at page level to avoid conflicts */}
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
            {/* PDF Viewer (optional) - Extracted to isolated component */}
          <ExtractionPDFPanel 
            articleId={articleId || ''} 
            projectId={projectId || ''} 
            showPDF={showPDF}
          />

            {/* Extraction form - Extracted to isolated component */}
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
                    userName: t('pages', 'extractionScreenYou'),
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

