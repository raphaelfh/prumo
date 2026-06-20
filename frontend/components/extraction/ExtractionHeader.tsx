/**
 * Extraction interface header — re-skinned onto the shared RunHeader compound.
 *
 * The ExtractionHeaderProps interface is kept stable (additive changes only) so
 * callers do not need to change. New optional props enable RunHeader features:
 * stage/transition/isRevision for the StageRail, reviewers for the Reviewers
 * slot, AI props for AIActions, and reopen affordance via the Menu.
 *
 * @component
 */

import { type UserRole } from '@/lib/comparison/permissions';
import { RunHeader, type RunHeaderValue, type StageTransition } from '@/components/runs/header';
import type { ExtractionRunStage } from '@/types/ai-extraction';
import type { SaveState } from '@/hooks/runs';
import { t } from '@/lib/copy';

// =================== INTERFACES ===================

interface Article {
  id: string;
  title: string;
}

export interface ExtractionHeaderProps {
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
  hasComparison: boolean;

  // Permissions and role (optional)
  userRole?: UserRole;
  isBlindMode?: boolean;

  // Status and actions
  saveState?: SaveState;
  lastSavedAt?: Date | null;
  hasUnsavedChanges?: boolean;
  isComplete: boolean;
  onFinalize: () => void;
  /** @deprecated Pass transition instead; kept for backward compat. */
  finalizeLabel?: string;
  submitting?: boolean;

  // AI Extraction (optional - kept for compatibility)
  templateId?: string;
  templateName?: string;
  /** Active run id — forwarded but not rendered directly by this header. */
  runId?: string | null;
  /** Whether AI extraction may run (only in PROPOSAL; one-time-done after). */
  canRunAI?: boolean;
  onExtractionComplete?: (runId?: string) => void | Promise<void>;

  // AI suggestions (for badge)
  aiSuggestions?: Record<string, unknown>;
  onAISuggestionsClick?: () => void;

  // Callback to refresh after extraction
  onRefreshInstances?: () => Promise<void>;
  // Callback to expose AI extraction state
  onExtractionStateChange?: (state: { loading: boolean; progress: unknown }) => void;

  // ---- NEW optional RunHeader features ----

  /** Current run stage. When provided, a StageRail is shown. */
  stage?: ExtractionRunStage;

  /** Pre-built stage transition from buildExtractionTransition(). */
  transition?: StageTransition | null;

  /** True when this run is a revision of a finalized run. */
  isRevision?: boolean;

  /** Reviewer state for the Reviewers slot. */
  reviewers?: { count: number; required: number; divergent: number };

  /** Whether the current user can reveal blind reviewer identities. */
  canReveal?: boolean;
  onReveal?: () => void;

  /** Jump to the compare/divergence view. */
  onJumpToDivergence?: () => void;

  /** Pending AI suggestion count for AIActions badge. */
  aiPendingCount?: number;

  /** Trigger AI extraction from the header. */
  onExtractWithAI?: () => void;
  extractingAI?: boolean;

  /** Show a "Reopen for revision" item in the Menu. */
  canReopen?: boolean;
  onReopen?: () => void;
  reopening?: boolean;
}

// =================== COMPONENT ===================

export function ExtractionHeader(props: ExtractionHeaderProps) {
  const {
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
    hasComparison,
    userRole,
    isBlindMode = false,
    saveState,
    lastSavedAt = null,
    submitting = false,
    stage = null,
    transition = null,
    isRevision = false,
    reviewers = { count: 0, required: 0, divergent: 0 },
    canReveal = false,
    onReveal,
    onJumpToDivergence,
    aiPendingCount = 0,
    onExtractWithAI,
    extractingAI = false,
    canRunAI = false,
    canReopen = false,
    onReopen,
    reopening = false,
  } = props;

  const headerValue: RunHeaderValue = {
    kind: 'extraction',
    stage,
    isRevision,
    role: userRole,
    isBlind: isBlindMode,
    canReveal,
    onReveal,
    progress: { completed: completedFields, total: totalFields, pct: completionPercentage },
    reviewers,
    transition,
    submitting,
    onJumpToDivergence,
  };

  return (
    <RunHeader value={headerValue}>
      <RunHeader.Left>
        <RunHeader.Breadcrumb onBack={onBack} crumbs={[{ label: projectName }, { label: articleTitle }]} />
        {articles.length > 1 && (
          <RunHeader.Worklist
            articles={articles}
            currentId={currentArticleId}
            onNavigate={onNavigateToArticle}
          />
        )}
        {stage != null && <RunHeader.StageRail />}
      </RunHeader.Left>

      <RunHeader.Center>
        <RunHeader.Reviewers />
        <RunHeader.RoleChip />
      </RunHeader.Center>

      <RunHeader.Right>
        <RunHeader.AIActions
          pendingCount={aiPendingCount}
          canExtract={!!(canRunAI && onExtractWithAI)}
          extracting={extractingAI}
          onExtract={onExtractWithAI ?? (() => {})}
          onOpenSuggestions={props.onAISuggestionsClick}
        />
        <RunHeader.PanelToggle pressed={showPDF} onToggle={onTogglePDF} />
        <RunHeader.Save
          state={saveState ?? 'idle'}
          lastSavedAt={lastSavedAt}
          hidden={stage === 'finalized'}
        />
        <RunHeader.PrimaryAction />
        <RunHeader.Menu>
          {hasComparison && (
            <RunHeader.MenuItem onSelect={() => onViewModeChange(viewMode === 'compare' ? 'extract' : 'compare')}>
              {t('extraction', 'runHeaderCompareToggle')}
            </RunHeader.MenuItem>
          )}
          {canReopen && (
            <RunHeader.MenuItem onSelect={() => onReopen?.()}>
              {reopening
                ? t('extraction', 'runHeaderReopening')
                : t('extraction', 'runHeaderReopenForRevision')}
            </RunHeader.MenuItem>
          )}
        </RunHeader.Menu>
      </RunHeader.Right>
    </RunHeader>
  );
}
