/**
 * Full-screen Quality Assessment interface
 *
 * Main page where the user assesses article quality/risk of bias.
 * Similar to ExtractionFullScreen, with PDF viewer and assessment form.
 *
 * Refactored to use new hooks and components (DRY + KISS)
 * Based on ExtractionFullScreen.tsx
 *
 * Features:
 * - PDF viewer with toggle
 * - Assessment form by domains
 * - Auto-save
 * - AI suggestions (prefill + badge)
 * - Progress tracking
 * - Article navigation
 *
 * @page
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {toast} from 'sonner';
import {supabase} from '@/integrations/supabase/client';
import {ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable';
import {Button} from '@/components/ui/button';
import {CheckCircle, Loader2} from 'lucide-react';

// Hooks
import {useAssessmentData} from '@/hooks/assessment/useAssessmentData';
import {useAssessmentResponses} from '@/hooks/assessment/useAssessmentResponses';
import {useAssessmentProgress} from '@/hooks/assessment/useAssessmentProgress';
import {useAssessmentAutoSave} from '@/hooks/assessment/useAssessmentAutoSave';
import {useAIAssessmentSuggestions} from '@/hooks/assessment/ai/useAIAssessmentSuggestions';
import {useSingleAssessment} from '@/hooks/assessment/ai/useSingleAssessment';
import {useBatchAssessment} from '@/hooks/assessment/ai/useBatchAssessment';
import {useCurrentUser} from '@/hooks/useCurrentUser';

// Components
import {AssessmentHeader} from '@/components/assessment/AssessmentHeader';
import {AssessmentPDFPanel} from '@/components/assessment/AssessmentPDFPanel';
import {AssessmentFormPanel} from '@/components/assessment/AssessmentFormPanel';
import {AssessmentHeaderAIActions} from '@/components/assessment/ai/AssessmentHeaderAIActions';
import {BatchAssessmentProgress} from '@/components/assessment/ai/BatchAssessmentProgress';

// Types
import type {AssessmentLevel, EvidencePassage} from '@/types/assessment';
import {t} from '@/lib/copy';

// =================== COMPONENT ===================

export default function AssessmentFullScreen() {
  const { projectId, articleId, instrumentId } = useParams();
  const navigate = useNavigate();

  // UI state
  const [showPDF, setShowPDF] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { userId } = useCurrentUser();

    // Load data via dedicated hook (SRP: separation of concerns)
  const {
    article,
    project,
    instrument,
    items,
    domains,
    articles,
    loading,
    error: dataError,
  } = useAssessmentData({
    projectId: projectId || '',
    articleId: articleId || '',
    instrumentId: instrumentId || '',
    enabled: !!projectId && !!articleId && !!instrumentId,
  });

    // Manage assessment responses
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
      extractionInstanceId: undefined, // Not hierarchical (not per model)
    toolType: instrument?.tool_type,
    items,
    enabled: !!projectId && !!articleId && !!instrumentId,
  });

    // Compute progress
  const { completedItems, totalItems, completionPercentage, isComplete } =
    useAssessmentProgress(responses, items);

    // Auto-save (only enable after values initialized)
  const { isSaving, lastSaved } = useAssessmentAutoSave({
    responses,
    save: saveResponses,
    enabled: !!projectId && !!articleId && !!instrumentId && !loading && responsesInitialized,
  });

  // T016 / FR-006: Refs declared after `responses` is initialized.
  // responsesRef keeps a live reference so handleTriggerAI can read the current
  // value at call time without adding `responses` to its dependency array.
  const responsesRef = useRef(responses);
  // Stores the selected_level value per item at the moment AI is triggered.
  // There is no auto-accept path, so FR-006 is also structurally guaranteed.
  const preAISnapshotRef = useRef<Record<string, string | null>>({});

  // T016: Keep responsesRef in sync so snapshot captures current value at trigger time
  useEffect(() => {
    responsesRef.current = responses;
  }, [responses]);

    // AI suggestion callbacks
  const handleAISuggestionAccepted = useCallback(
    async (
      itemId: string,
      suggestionValue: { level: AssessmentLevel; evidence_passages: EvidencePassage[] }
    ) => {
      // FR-001: On explicit Accept, update radio button regardless of pre-AI snapshot
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
      // Clear the form field when suggestion is rejected (mirrors extraction pattern)
      updateResponse(itemId, {
        selected_level: '',
        notes: null,
        evidence: [],
      });
    },
    [updateResponse]
  );

    // AI suggestions
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

    // Single-item assessment
  const [triggeringItemId, setTriggeringItemId] = useState<string | null>(null);
  const { assessItem } = useSingleAssessment({
    onSuccess: async (suggestionId) => {
      try {
        const result = await refreshSuggestions();
        // T017: Check for the specific new suggestion rather than a generic count,
        // so the retry fires correctly even when older suggestions already exist.
        const hasNewSuggestion = Object.values(result.suggestions).some(
          (s) => s.id === suggestionId
        );
        if (!hasNewSuggestion) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          await refreshSuggestions();
        }
      } catch (error) {
          console.error('[AssessmentFullScreen] Error reloading suggestions:', error);
      } finally {
        // T016: Clear trigger AFTER refresh so spinner stays until card can render
        setTriggeringItemId(null);
        // Clean up snapshot for this item
        const itemId = triggeringItemId;
        if (itemId) delete preAISnapshotRef.current[itemId];
      }
    },
  });

    // Single-item assessment trigger handler
  const handleTriggerAI = useCallback(
    async (itemId: string) => {
      setTriggeringItemId(itemId);
      // T016 / FR-006: Snapshot the current response before AI processing begins.
      // If the user edits the field while AI is processing, the card will still appear
      // but no automatic override occurs (there is no auto-accept path).
      // Explicit Accept always applies FR-001 regardless of this snapshot.
      preAISnapshotRef.current[itemId] = responsesRef.current[itemId]?.selected_level ?? null;
      try {
        await assessItem({
          projectId: projectId || '',
          articleId: articleId || '',
          instrumentId: instrumentId || '',
          assessmentItemId: itemId,
          model: 'gpt-4o-mini',
        });
      } catch (error) {
          console.error('Error assessing item:', error);
        setTriggeringItemId(null);
        delete preAISnapshotRef.current[itemId];
      }
    },
    [projectId, articleId, instrumentId, assessItem]
  );

    // Batch assessment
  const {
    assessBatch,
    loading: batchLoading,
    progress: batchProgress,
  } = useBatchAssessment({
    onComplete: async () => {
      try {
        const result = await refreshSuggestions();
        if (result.count === 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          await refreshSuggestions();
        }
      } catch (error) {
          console.error('Error reloading suggestions after batch:', error);
      }
    },
  });

    // Batch assessment handler
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

    // Article navigation
  const handleNavigateToArticle = (newArticleId: string) => {
    navigate(`/projects/${projectId}/assessment/${newArticleId}/${instrumentId}`);
  };

    // Finalize assessment
  const handleSubmit = async () => {
    if (!isComplete) {
        toast.error(t('pages', 'assessmentScreenCompleteRequired'));
      return;
    }

    setSubmitting(true);
    try {
        // Save final responses
      await saveResponses();

        // Update status to submitted
      if (!userId) {
          throw new Error(t('common', 'errors_userNotAuthenticated'));
      }

      const { error } = await supabase
        .from('assessments')
        .update({ status: 'submitted' })
        .eq('article_id', articleId)
        .eq('instrument_id', instrumentId)
        .eq('user_id', userId)
        .eq('is_current_version', true);

      if (error) throw error;

        toast.success(t('pages', 'assessmentScreenSubmitSuccess'));
      navigate(`/projects/${projectId}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : t('pages', 'assessmentScreenErrorFinalize');
        console.error('Error finalizing assessment:', error);
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
          <p className="text-destructive">{t('pages', 'assessmentScreenErrorLoad')}</p>
          <Button
              onClick={() => navigate(`/projects/${projectId}`)}>{t('pages', 'assessmentScreenBackToProject')}</Button>
      </div>
    );
  }

  // No instrument state
  if (!instrument) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
          <p className="text-muted-foreground">{t('pages', 'assessmentScreenNoInstrument')}</p>
          <Button
              onClick={() => navigate(`/projects/${projectId}`)}>{t('pages', 'assessmentScreenBackToProject')}</Button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <AssessmentHeader
          projectName={project?.name || t('pages', 'extractionScreenProjectFallback')}
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
                isTriggerLoading: (itemId) => triggeringItemId === itemId,
                triggeringItemId,
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
                        {t('pages', 'assessmentScreenFinalizing')}
                    </>
                  ) : (
                    <>
                      <CheckCircle className="mr-2 h-4 w-4" />
                        {t('pages', 'assessmentScreenCompleteAssessment')}
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
