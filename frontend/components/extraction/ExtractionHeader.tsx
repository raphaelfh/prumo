/**
 * Extraction interface header — composed from the shared RunHeader compound.
 *
 * stage/transition/isRevision/reviewers feed the RunStatus cluster (stage
 * chip + avatars + status popover), AI props feed the AIActions menu, and the
 * reopen affordance lives in the Menu + command palette.
 *
 * @component
 */

import { useState } from 'react';
import { type UserRole } from '@/lib/comparison/permissions';
import { RunHeader, type RunHeaderValue, type StageTransition } from '@/components/runs/header';
// Utility is imported directly (not via the RunHeader compound): it pulls in the
// app-wide NotificationCenter/feedback, which reach the supabase client, and the
// shared compound must stay free of that so its pure part tests don't need it.
import { Utility } from '@/components/runs/header/Utility';
import type { ExtractionRunStage } from '@/types/ai-extraction';
import type { SaveState } from '@/hooks/runs';
import { useRunShortcuts } from '@/hooks/runs/useRunShortcuts';
import { t } from '@/lib/copy';

// =================== INTERFACES ===================

interface Article {
  id: string;
  title: string;
}

export interface ExtractionHeaderProps {
  // Navigation — the article title is the single identity text; project
  // context lives in the sidebar and behind onBack (spec 2026-07-02).
  articleTitle: string;
  onBack: () => void;

  // App sidebar collapse state + toggle (focus-shell wiring for ⌘B). Below `lg`
  // the desktop sidebar is hidden, so onOpenMobileNav opens the drawer instead.
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenMobileNav?: () => void;

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
  /** @deprecated Legacy header finalize path; the primary action now flows
   * through `transition` (Finish extraction / Start consensus / Approve &
   * finalize). Optional + unused; full removal is HITL Phase 3. */
  onFinalize?: () => void;
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

  /** Current run stage. When provided, the RunStatus cluster is shown. */
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

  /** Show a "Reopen extraction" item in the Menu (consensus stage, arbitrator only). */
  canReopenExtraction?: boolean;
  onReopenExtraction?: () => void;
}

// =================== COMPONENT ===================

export function ExtractionHeader(props: ExtractionHeaderProps) {
  const {
    articleTitle,
    onBack,
    sidebarCollapsed,
    onToggleSidebar,
    onOpenMobileNav,
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
    canReopenExtraction = false,
    onReopenExtraction,
  } = props;

  // ---- Cmd-K palette + status-popover state (palette's "View run status"
  // action drives the controlled RunStatus) ----
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  // Header keyboard shortcuts (documented in the "?" Help panel). ⌘B (sidebar)
  // is owned by the RunWorkspaceShell, not here.
  useRunShortcuts({
    articles,
    currentArticleId,
    onNavigateToArticle,
    onTogglePanel: onTogglePDF,
    onTogglePalette: () => setPaletteOpen((prev) => !prev),
    onClosePalette: () => setPaletteOpen(false),
  });

  // ---- Palette actions: surface all edge-action handlers ----
  // note: Export lives in ExtractionExportDialog, not the header
  const paletteActions: { id: string; label: string; run: () => void }[] = [];

  if (hasComparison) {
    paletteActions.push({
      id: 'compare',
      label: t('extraction', 'runHeaderCompareToggle'),
      run: () => onViewModeChange(viewMode === 'compare' ? 'extract' : 'compare'),
    });
  }
  if (canReopen) {
    paletteActions.push({
      id: 'reopen',
      label: t('extraction', 'runHeaderReopenForRevision'),
      run: () => onReopen?.(),
    });
  }
  if (canReopenExtraction) {
    paletteActions.push({
      id: 'reopen-extraction',
      label: t('extraction', 'runHeaderReopenExtraction'),
      run: () => onReopenExtraction?.(),
    });
  }
  paletteActions.push({
    id: 'panel',
    label: t('runs', 'togglePanel'),
    run: () => onTogglePDF(),
  });
  if (canReveal && onReveal) {
    paletteActions.push({
      id: 'reveal',
      label: t('runs', 'reveal'),
      run: () => onReveal(),
    });
  }
  if (stage != null) {
    paletteActions.push({
      id: 'status',
      label: t('runs', 'viewRunStatus'),
      run: () => setStatusOpen(true),
    });
  }
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
    <>
      {/* HeaderShell (inside RunHeader) owns the @container/headerbar — the
          header's own width drives the collapse, no consumer wrapper needed. */}
        <RunHeader value={headerValue}>
          <RunHeader.Left>
            <RunHeader.MobileNav onOpen={onOpenMobileNav} />
            <RunHeader.SidebarToggle pressed={!sidebarCollapsed} onToggle={onToggleSidebar} />
            <RunHeader.Breadcrumb onBack={onBack} title={articleTitle} />
            <RunHeader.Save
              state={saveState ?? 'idle'}
              lastSavedAt={lastSavedAt}
              hidden={stage === 'finalized'}
            />
          </RunHeader.Left>

          <RunHeader.Center>
            <RunHeader.Worklist
              articles={articles}
              currentId={currentArticleId}
              onNavigate={onNavigateToArticle}
            />
          </RunHeader.Center>

          <RunHeader.Right>
            {stage != null && <RunHeader.RunStatus open={statusOpen} onOpenChange={setStatusOpen} />}
            {hasComparison && (
              <RunHeader.CompareToggle
                active={viewMode === 'compare'}
                onToggle={() => onViewModeChange(viewMode === 'compare' ? 'extract' : 'compare')}
                label={t('runs', 'compareToggleLabel')}
              />
            )}
            <RunHeader.AIActions
              pendingCount={aiPendingCount}
              canExtract={!!(canRunAI && onExtractWithAI)}
              extracting={extractingAI}
              onExtract={onExtractWithAI ?? (() => {})}
              onOpenSuggestions={props.onAISuggestionsClick}
            />
            <RunHeader.PrimaryAction />
            <Utility>
              {canReopen && (
                <RunHeader.MenuItem onSelect={() => onReopen?.()}>
                  {reopening
                    ? t('extraction', 'runHeaderReopening')
                    : t('extraction', 'runHeaderReopenForRevision')}
                </RunHeader.MenuItem>
              )}
              {canReopenExtraction && (
                <RunHeader.MenuItem onSelect={() => onReopenExtraction?.()}>
                  {t('extraction', 'runHeaderReopenExtraction')}
                </RunHeader.MenuItem>
              )}
            </Utility>
            <RunHeader.PanelToggle pressed={showPDF} onToggle={onTogglePDF} />
          </RunHeader.Right>
        </RunHeader>

      {/* Cmd-K palette — mounted at page level so it renders above the header */}
      <RunHeader.CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        actions={paletteActions}
        articles={articles.length > 1 ? articles : undefined}
        onNavigate={articles.length > 1 ? onNavigateToArticle : undefined}
      />
    </>
  );
}
