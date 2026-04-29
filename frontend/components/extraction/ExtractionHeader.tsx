/**
 * Unified extraction interface header
 *
 * Refactored component following DRY, KISS, unified and responsive principles.
 * Uses smaller extracted components for better maintainability.
 *
 * @component
 */

import {TooltipProvider,} from '@/components/ui/tooltip';
import {useIsMobile} from '@/hooks/use-mobile';
import {type UserRole} from '@/lib/comparison/permissions';
import {HeaderNavigation} from './header/HeaderNavigation';
import {HeaderPDFControls} from './header/HeaderPDFControls';
import {HeaderStatusBadges} from './header/HeaderStatusBadges';
import {HeaderFinalizeButton} from './header/HeaderFinalizeButton';
import {HeaderAIActions} from './header/HeaderAIActions';
import {HeaderMoreMenu} from './header/HeaderMoreMenu';
import type {AISuggestion} from '@/types/ai-extraction';
import type {ExtractionValueDisplay, ExtractionInstance, ProjectExtractionTemplate} from '@/types/extraction';

// =================== INTERFACES ===================

interface Article {
  id: string;
  title: string;
}

interface ExtractionHeaderProps {
    // Navigation
  projectId: string;
  projectName: string;
  articleTitle: string;
  onBack: () => void;

    // Article navigation
  articles: Article[];
  currentArticleId: string;
  onNavigateToArticle: (articleId: string) => void;

    // Progress
  completedFields: number;
  totalFields: number;
  completionPercentage: number;

    // View controls
  showPDF: boolean;
  onTogglePDF: () => void;
  viewMode: 'extract' | 'compare';
  onViewModeChange: (mode: 'extract' | 'compare') => void;
  hasOtherExtractions: boolean;

    // Permissions and role (optional)
  userRole?: UserRole;
  isBlindMode?: boolean;

    // Status and actions
  isSaving?: boolean;
  lastSaved?: Date | null;
  isComplete: boolean;
  onFinalize: () => void;
  /** Optional label override for the finalize button — set to
   * "Submit for review" while the run is still in PROPOSAL. */
  finalizeLabel?: string;
  submitting?: boolean;

    // AI Extraction (optional - kept for compatibility)
  templateId?: string;
  templateName?: string;
  /** Active run id forwarded to HeaderMoreMenu so "Extract with AI"
   * reuses the open run instead of creating a parallel one. */
  runId?: string | null;
  onExtractionComplete?: (runId?: string) => void | Promise<void>;

    // AI suggestions (for Zone 4 badge)
  aiSuggestions?: Record<string, AISuggestion>;
  onAISuggestionsClick?: () => void;

    // Data for export (Zone 4 - More menu)
  template?: ProjectExtractionTemplate | null;
  instances?: ExtractionInstance[];
  values?: ExtractionValueDisplay[];

    // Callback to refresh after extraction
  onRefreshInstances?: () => Promise<void>;
    // Callback to expose AI extraction state
  onExtractionStateChange?: (state: { loading: boolean; progress: any }) => void;
}

// =================== COMPONENT ===================

export function ExtractionHeader(props: ExtractionHeaderProps) {
  const {
    projectId,
    projectName,
    articleTitle,
    onBack,
    articles,
    currentArticleId,
    onNavigateToArticle,
    completedFields,
    totalFields,
    completionPercentage,
    showPDF,
    onTogglePDF,
    viewMode,
    onViewModeChange,
    hasOtherExtractions,
    userRole,
    isBlindMode,
    isSaving = false,
    lastSaved = null,
    isComplete,
    onFinalize,
    finalizeLabel,
    submitting = false,
    aiSuggestions = {},
    onAISuggestionsClick,
    template,
    instances = [],
    values = [],
  } = props;

  const isMobile = useIsMobile();

  return (
    <TooltipProvider delayDuration={200}>
      <header className="border-b border-border/40 bg-background/80 backdrop-blur-sm relative z-10 shadow-sm">
        {isMobile ? (
          /* Mobile Layout: Minimalista e organizado */
          <div className="flex flex-col px-4 py-2.5 gap-2.5">
              {/* Row 1: Navigation + Status + Finalize */}
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <HeaderNavigation
                  projectId={projectId}
                  projectName={projectName}
                  articleTitle={articleTitle}
                  onBack={onBack}
                  showBackText={false}
                  maxBreadcrumbWidth="200px"
                  articles={articles}
                  currentArticleId={currentArticleId}
                  onNavigateToArticle={onNavigateToArticle}
                />
              </div>
              
              <div className="flex items-center gap-2 flex-shrink-0">
                <HeaderStatusBadges
                  userRole={userRole}
                  isBlindMode={isBlindMode}
                  completedFields={completedFields}
                  totalFields={totalFields}
                  completionPercentage={completionPercentage}
                  isSaving={isSaving}
                  lastSaved={lastSaved}
                  compact={true}
                />
              </div>
              
              <div className="flex-shrink-0">
                <HeaderFinalizeButton
                  isComplete={isComplete}
                  onSubmit={onFinalize}
                  submitting={submitting}
                  variant="default"
                  size="sm"
                  label={finalizeLabel}
                />
              </div>
            </div>

              {/* Row 2: PDF controls + Secondary actions */}
            <div className="flex items-center justify-between pt-2 border-t border-border/40">
              <HeaderPDFControls
                showPDF={showPDF}
                onTogglePDF={onTogglePDF}
                articles={articles}
                currentArticleId={currentArticleId}
                onNavigateToArticle={onNavigateToArticle}
                viewMode={viewMode}
                onViewModeChange={onViewModeChange}
                hasOtherExtractions={hasOtherExtractions}
                compact={true}
              />

                {/* Zone 4: Secondary actions (Mobile) */}
              <div className="flex items-center gap-2">
                <HeaderAIActions
                  suggestions={aiSuggestions}
                  onClick={onAISuggestionsClick}
                  compact={true}
                />
                <HeaderMoreMenu
                  projectId={projectId}
                  template={template}
                  instances={instances}
                  values={values}
                  compact={true}
                  articleId={currentArticleId}
                  templateId={template?.id}
                  runId={props.runId}
                  onExtractionComplete={props.onRefreshInstances}
                  onExtractionStateChange={props.onExtractionStateChange}
                />
              </div>
            </div>
          </div>
        ) : (
            /* Desktop layout: 5 zones per UX - header h-12 */
            <div className="flex h-12 items-center justify-between gap-6 px-6">
                {/* Zone 1: Contextual navigation (far left) */}
            <div className="flex-1 min-w-0">
              <HeaderNavigation
                projectId={projectId}
                projectName={projectName}
                articleTitle={articleTitle}
                onBack={onBack}
                showBackText={true}
                maxBreadcrumbWidth="400px"
                articles={articles}
                currentArticleId={currentArticleId}
                onNavigateToArticle={onNavigateToArticle}
              />
            </div>

                {/* Zone 2: View controls (center-left) */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <HeaderPDFControls
                showPDF={showPDF}
                onTogglePDF={onTogglePDF}
                articles={articles}
                currentArticleId={currentArticleId}
                onNavigateToArticle={onNavigateToArticle}
                viewMode={viewMode}
                onViewModeChange={onViewModeChange}
                hasOtherExtractions={hasOtherExtractions}
                compact={false}
              />
            </div>

            {/* Zona 3: Status e Feedback (Centro) */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <HeaderStatusBadges
                userRole={userRole}
                isBlindMode={isBlindMode}
                completedFields={completedFields}
                totalFields={totalFields}
                completionPercentage={completionPercentage}
                isSaving={isSaving}
                lastSaved={lastSaved}
                compact={false}
              />
            </div>

                {/* Zone 4: Secondary actions (center-right) */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <HeaderAIActions
                suggestions={aiSuggestions}
                onClick={onAISuggestionsClick}
                compact={false}
              />
              <HeaderMoreMenu
                projectId={projectId}
                template={template}
                instances={instances}
                values={values}
                compact={false}
                articleId={currentArticleId}
                templateId={template?.id}
                runId={props.runId}
                onExtractionComplete={props.onRefreshInstances}
                onExtractionStateChange={props.onExtractionStateChange}
              />
            </div>

                {/* Zone 5: Primary action (far right) */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <HeaderFinalizeButton
                isComplete={isComplete}
                onSubmit={onFinalize}
                submitting={submitting}
                variant="default"
                size="sm"
                label={finalizeLabel}
              />
            </div>
          </div>
        )}
      </header>
    </TooltipProvider>
  );
}
