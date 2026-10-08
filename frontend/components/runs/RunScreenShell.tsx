/**
 * The run screen both kinds render (extraction, quality assessment): the
 * split workspace (form left, reader right), the run header with its ⌘K
 * palette and keyboard shortcuts, the published/revision banner, the
 * editability context the form reads, the consensus resolve table, and the
 * reopen-to-extract confirm.
 *
 * Everything lifecycle-shaped comes from `useRunLifecycleScreen`; a screen
 * supplies only what is its own — its title, progress, AI actions, form panel
 * and the template shape the consensus table resolves over.
 */

import { useState, type ReactNode } from 'react';

import { ConsensusResolutionPanel } from '@/components/runs/ConsensusResolutionPanel';
import { HITLPublishedBanner } from '@/components/runs/HITLStatusBadges';
import { RunEditabilityProvider } from '@/components/runs/RunEditabilityContext';
import { RunPdfContent } from '@/components/runs/RunPdfContent';
import type {
  ComparisonEntityType,
  ComparisonInstance,
  ConsensusTraceContext,
} from '@/components/runs/RunReviewerComparison';
import { RunSplitShell } from '@/components/runs/RunSplitShell';
import { RunHeader } from '@/components/runs/header';
// Imported directly (not via the RunHeader compound): Utility pulls in the
// app-wide NotificationCenter, which reaches the supabase client, and the
// shared compound must stay free of that.
import { Utility } from '@/components/runs/header/Utility';
import { ReopenExtractionDialog } from '@/components/extraction/dialogs/ReopenExtractionDialog';
import { useSidebar } from '@/contexts/SidebarContext';
import type { SaveState } from '@/hooks/runs';
import type { RunLifecycleScreen, RunWorklist } from '@/hooks/runs/useRunLifecycleScreen';
import type { RunReader } from '@/hooks/runs/useRunReader';
import { useRunShortcuts } from '@/hooks/runs/useRunShortcuts';
import type { RunViewResponse } from '@/hooks/runs/types';
import type { ComparisonPermissions } from '@/hooks/shared/useComparisonPermissions';
import { t } from '@/lib/copy';
import { runScreenSpec } from '@/lib/runs/runScreenKind';

export interface RunScreenConsensus {
  entityTypes: ComparisonEntityType[];
  instances: ComparisonInstance[];
  /** Form values keyed by `coordKey`. */
  ownValues: Record<string, unknown>;
  /** The screen's AI trace; peer-identity gating is the shell's. */
  aiTrace: Omit<ConsensusTraceContext, 'showPeerIdentity' | 'currentUserId'>;
}

export interface RunScreenShellProps {
  lifecycle: RunLifecycleScreen;
  runDetail: RunViewResponse | undefined;
  permissions: ComparisonPermissions;
  currentUserId: string;
  worklist: RunWorklist;
  reader: RunReader;
  projectId: string;
  articleId: string;
  /** The breadcrumb identity, and any chips that follow it. */
  title: string;
  titleAdornment?: ReactNode;
  progress: { completed: number; total: number; pct: number };
  save: { state: SaveState | undefined; lastSavedAt: Date | null | undefined };
  ai: {
    pendingCount: number;
    canExtract: boolean;
    extracting: boolean;
    onExtract: () => void;
    onOpenSuggestions: () => void;
  };
  formPanel: ReactNode;
  /** The consensus table's inputs; null while the screen cannot render it yet. */
  consensus: RunScreenConsensus | null;
}

export function RunScreenShell(props: RunScreenShellProps) {
  const { lifecycle, runDetail, permissions, worklist, reader } = props;
  const { kind, stage, compare, reopen, reveal, consensus } = lifecycle;
  const spec = runScreenSpec(kind);
  // App navigation sidebar (provided by RunWorkspaceShell): SidebarToggle + ⌘B
  // collapse it on lg+, MobileNav opens the drawer below lg.
  const { sidebarCollapsed, toggleSidebar, toggleMobile } = useSidebar();

  // ⌘K palette + the status popover its "View run status" action opens.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  // Every run-screen binding ([ / ], ⌘K, Escape) lives in the one shared hook,
  // which owns the not-while-typing / no-modifier / end-of-list guards. ⌘B is
  // the workspace shell's, ⇧⌘B the panel toggle's.
  useRunShortcuts({
    articles: worklist.articles,
    currentArticleId: worklist.currentId,
    onNavigateToArticle: worklist.goToArticle,
    onTogglePalette: () => setPaletteOpen((prev) => !prev),
    onClosePalette: () => setPaletteOpen(false),
  });

  // Each palette entry mirrors a control reachable in the current stage and role.
  const paletteActions: { id: string; label: string; run: () => void }[] = [];
  if (compare.available) {
    paletteActions.push({ id: 'compare', label: spec.paletteCompare, run: compare.toggle });
  }
  if (spec.paletteOffersReopen && reopen.canReopen) {
    paletteActions.push({
      id: 'reopen',
      label: spec.menu.reopenRevision,
      run: () => void reopen.reopenRevision(),
    });
  }
  if (spec.paletteOffersReopen && reopen.canReopenToExtract) {
    paletteActions.push({
      id: 'reopen-extraction',
      label: spec.menu.reopenToExtract,
      run: () => reopen.setConfirmOpen(true),
    });
  }
  paletteActions.push({ id: 'panel', label: t('runs', 'togglePanel'), run: reader.pdf.toggle });
  if (reveal.canReveal) {
    paletteActions.push({ id: 'reveal', label: t('runs', 'reveal'), run: reveal.onReveal });
  }
  if (stage != null) {
    paletteActions.push({ id: 'status', label: t('runs', 'viewRunStatus'), run: () => setStatusOpen(true) });
  }
  const pageable = worklist.articles.length > 1;

  // HeaderShell (inside RunHeader) owns the @container/headerbar. The palette
  // is a SIBLING of the header, not a child: it renders above it.
  const header = (
    <>
      <RunHeader
        value={{
          kind,
          stage,
          isRevision: !!lifecycle.parentRunId,
          role: permissions.userRole,
          isBlind: permissions.isBlindMode,
          canReveal: reveal.canReveal,
          onReveal: reveal.onReveal,
          progress: props.progress,
          reviewers: lifecycle.reviewers.header,
          transition: lifecycle.transition,
          submitting: lifecycle.submitting,
          onJumpToDivergence: compare.jumpToDivergence,
        }}
      >
        <RunHeader.Left>
          <RunHeader.MobileNav onOpen={toggleMobile} />
          <RunHeader.SidebarToggle pressed={!sidebarCollapsed} onToggle={toggleSidebar} />
          <RunHeader.Breadcrumb onBack={worklist.exit} title={props.title} />
          {props.titleAdornment}
          <RunHeader.Save
            state={props.save.state ?? 'idle'}
            lastSavedAt={props.save.lastSavedAt ?? null}
            hidden={stage === null || lifecycle.finalized}
          />
        </RunHeader.Left>

        <RunHeader.Center>
          {/* Self-guards: renders null below two articles or on an unknown id. */}
          <RunHeader.Worklist
            articles={worklist.articles}
            currentId={worklist.currentId}
            onNavigate={worklist.goToArticle}
          />
        </RunHeader.Center>

        <RunHeader.Right>
          {stage != null && <RunHeader.RunStatus open={statusOpen} onOpenChange={setStatusOpen} />}
          {compare.available && (
            <RunHeader.CompareToggle
              active={compare.active}
              onToggle={compare.toggle}
              label={t('runs', 'compareToggleLabel')}
            />
          )}
          <RunHeader.AIActions
            pendingCount={props.ai.pendingCount}
            canExtract={props.ai.canExtract}
            extracting={props.ai.extracting}
            onExtract={props.ai.onExtract}
            onOpenSuggestions={props.ai.onOpenSuggestions}
          />
          <RunHeader.PrimaryAction />
          <Utility>
            {reopen.canReopen && (
              <RunHeader.MenuItem onSelect={() => void reopen.reopenRevision()}>
                {reopen.reopening ? spec.menu.reopening : spec.menu.reopenRevision}
              </RunHeader.MenuItem>
            )}
            {reopen.canReopenToExtract && (
              <RunHeader.MenuItem onSelect={() => reopen.setConfirmOpen(true)}>
                {spec.menu.reopenToExtract}
              </RunHeader.MenuItem>
            )}
          </Utility>
          <RunHeader.PanelToggle pressed={reader.pdf.isOpen} onToggle={reader.pdf.toggle} />
        </RunHeader.Right>
      </RunHeader>

      <RunHeader.CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        actions={paletteActions}
        articles={pageable ? worklist.articles : undefined}
        onNavigate={pageable ? worklist.goToArticle : undefined}
      />
      <ReopenExtractionDialog
        kind={kind}
        open={reopen.confirmOpen}
        onOpenChange={reopen.setConfirmOpen}
        resolvedCount={consensus.resolvedCount}
        onConfirm={reopen.reopenToExtract}
        pending={reopen.reopenToExtractPending}
      />
    </>
  );

  // The consensus stage has one surface: the resolve table (D6).
  const consensusInputs = props.consensus;
  const formPanel =
    lifecycle.inConsensusStage && runDetail && consensusInputs ? (
      <div className="h-full min-h-0 overflow-y-auto" data-testid={`${kind}-consensus-area`}>
        <ConsensusResolutionPanel
          runDetail={runDetail}
          summary={lifecycle.reviewers.summary}
          entityTypes={consensusInputs.entityTypes}
          instances={consensusInputs.instances}
          ownValues={consensusInputs.ownValues}
          requiredCoords={consensus.requiredCoords}
          peersRevealed={!!runDetail.peers_revealed}
          reviewerLabelById={lifecycle.reviewers.profiles.labelById}
          reviewerAvatarById={lifecycle.reviewers.profiles.avatarById}
          // Resolving is an arbitrator action (ADR-0018); the backend 403s the rest.
          canResolve={permissions.canResolveConflicts}
          // Consensus AI trace (D2): a top-level channel; peer cross-marks
          // collapse to self in blind review (the server strips peer rows too).
          aiTrace={{
            ...consensusInputs.aiTrace,
            showPeerIdentity: lifecycle.showPeerIdentity,
            currentUserId: props.currentUserId || null,
          }}
          onSelectExisting={consensus.onSelectExisting}
          onManualOverride={consensus.onManualOverride}
          onFinalize={consensus.onApproveFinalize}
          isResolving={consensus.resolving}
          isFinalizing={consensus.finalizing}
          // The header owns Approve & finalize.
          showFinalize={false}
        />
      </div>
    ) : (
      props.formPanel
    );

  return (
    <RunSplitShell
      pdfState={reader.pdf}
      viewerStore={reader.viewerStore}
      header={header}
      subHeader={
        // Published/revision banner between header and panels (spec 2026-07-02 D4).
        <HITLPublishedBanner
          kind={kind}
          finalized={reopen.canReopen}
          parentRunId={lifecycle.parentRunId}
          onReopen={() => void reopen.reopenRevision()}
          reopening={reopen.reopening}
        />
      }
      formPanel={
        // The viewer role renders read-only; showPeerIdentity gates "Run by {name}".
        <RunEditabilityProvider
          stage={stage}
          showPeerIdentity={lifecycle.showPeerIdentity}
          forceReadOnly={permissions.userRole === 'viewer'}
        >
          {formPanel}
        </RunEditabilityProvider>
      }
      pdfPanel={
        <RunPdfContent
          articleId={props.articleId}
          projectId={props.projectId}
          store={reader.viewerStore}
          expanded={reader.pdf.isExpanded}
          onToggleExpand={reader.pdf.toggleExpanded}
        />
      }
    />
  );
}
