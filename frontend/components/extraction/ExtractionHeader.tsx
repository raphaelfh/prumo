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

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

  // App sidebar collapse state + toggle (focus-shell wiring for ⌘B).
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;

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
  const navigate = useNavigate();
  const {
    projectName,
    articleTitle,
    onBack,
    sidebarCollapsed,
    onToggleSidebar,
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

  // ---- Cmd-K palette state ----
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Header keyboard shortcuts (documented in the "?" Help panel). The changing
  // callbacks/lists live in a ref so the listener registers ONCE (empty deps)
  // rather than re-binding every render. Cleanup via return, NOT try/finally
  // (React Compiler). ⌘B (sidebar) is owned by the RunWorkspaceShell, not here.
  const kbdRef = useRef({ articles, currentArticleId, onNavigateToArticle, onTogglePDF });
  useEffect(() => {
    kbdRef.current = { articles, currentArticleId, onNavigateToArticle, onTogglePDF };
  }, [articles, currentArticleId, onNavigateToArticle, onTogglePDF]);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { articles, currentArticleId, onNavigateToArticle, onTogglePDF } = kbdRef.current;
      const target = e.target as HTMLElement;
      const isEditing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable;
      // ⌘K / Ctrl+K — toggle the command palette.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (isEditing) return;
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }
      // Remaining shortcuts are unmodified single keys, never while typing.
      if (e.metaKey || e.ctrlKey || e.altKey || isEditing) return;
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        return;
      }
      if (e.key === '\\') {
        e.preventDefault();
        onTogglePDF();
        return;
      }
      if (articles.length > 1 && (e.key === 'j' || e.key === 'J')) {
        const i = articles.findIndex((a) => a.id === currentArticleId);
        if (i >= 0 && i < articles.length - 1) onNavigateToArticle(articles[i + 1].id);
        return;
      }
      if (articles.length > 1 && (e.key === 'k' || e.key === 'K')) {
        const i = articles.findIndex((a) => a.id === currentArticleId);
        if (i > 0) onNavigateToArticle(articles[i - 1].id);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

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
      {/* Container-query wrapper: the header's OWN width drives the collapse. */}
      <div className="@container/headerbar">
        <RunHeader value={headerValue}>
          <RunHeader.Left>
            <RunHeader.SidebarToggle pressed={!sidebarCollapsed} onToggle={onToggleSidebar} />
            <RunHeader.Breadcrumb onBack={onBack} crumbs={[{ label: projectName, onClick: () => navigate(`/projects/${props.projectId}`) }, { label: articleTitle }]} />
            {articles.length > 1 && (
              <RunHeader.Worklist
                articles={articles}
                currentId={currentArticleId}
                onNavigate={onNavigateToArticle}
              />
            )}
            <RunHeader.Save
              state={saveState ?? 'idle'}
              lastSavedAt={lastSavedAt}
              hidden={stage === 'finalized'}
            />
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
            <RunHeader.PrimaryAction />
            <span className="mx-1 hidden h-5 w-px bg-border/60 @[40rem]/headerbar:block" aria-hidden="true" />
            <span className="hidden @[40rem]/headerbar:inline-flex">
              <RunHeader.Help />
            </span>
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
            <RunHeader.PanelToggle pressed={showPDF} onToggle={onTogglePDF} />
          </RunHeader.Right>
        </RunHeader>
      </div>

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
