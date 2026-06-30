import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HeaderShell } from '@/components/layout/HeaderShell';
import { RunHeaderProvider, type RunHeaderValue } from './RunHeaderContext';
import { StageRail } from './StageRail';
import { PrimaryAction } from './PrimaryAction';
import { PanelToggle } from './PanelToggle';
import { SidebarToggle } from './SidebarToggle';
import { MobileNav } from './MobileNav';
import { Help } from './Help';
import { RoleChip } from './RoleChip';
import { Reviewers } from './Reviewers';
import { SaveSlot } from './SaveSlot';
import { AIActions } from './AIActions';
import { Breadcrumb } from './Breadcrumb';
import { CompareToggle } from './CompareToggle';
import { Menu, MenuItem } from './Menu';
import { Worklist } from './Worklist';
import { CommandPalette } from './CommandPalette';

/**
 * RESPONSIVE DROP CASCADE (single source of truth for the scattered @container
 * thresholds across the leaf components). The header keys off its OWN width via
 * `@container/headerbar`. Target priority (highest survives longest):
 *
 *   pager  >  article title  >  stages  >  reviewers  >  project crumb  >  back
 *
 * Mechanism — only the title flex-shrinks (truncates); the pager + actions are
 * shrink-0; everything else DROPS at a container-query threshold. As the header
 * narrows, leaves disappear in this BY-WIDTH order (see each component):
 *
 *   reviewers cluster  <64rem  (Reviewers.tsx)   ← drops first
 *   back arrow         <42rem  (Breadcrumb.tsx)
 *   stages rail        <40rem  (StageRail.tsx) + role chip <40rem (RoleChip.tsx)
 *   project crumb      <36rem  (Breadcrumb.tsx)
 *   article title       never  (pure flex-shrink; truncates, can reach ~0 in the
 *                               packed consensus config at oddball mid widths)
 *   pager               never  (own shrink-0 slot, below)
 *   verbose labels: reviewer/role/stage text fold at 62–72rem; save word <34rem.
 *
 * NOTE the by-width order is NOT the literal priority rank: reviewers drop BEFORE
 * back/project even though they outrank them. This is deliberate — reviewers can
 * only HIDE (fixed-size avatars), not shrink, and they appear only in the crowded
 * consensus config; folding them early frees the room the (higher-priority) title
 * needs, honouring "title > reviewer". Container queries are width-based and
 * config-blind, so a strict rank-ordered fold isn't expressible in pure CSS; a
 * JS measured priority-overflow would be (deferred).
 */
function Left({ children }: { children: ReactNode }) {
  // Identity + run-status track. It SHRINKS (the breadcrumb title truncates) and
  // keeps `overflow-hidden` ONLY as an anti-overlap backstop: its leaves are
  // `whitespace-nowrap`, so without it a shrunk track would paint its text on
  // top of the next slot. It is no longer `flex-1` (that starved it to ~0 and
  // clipped everything) and — crucially — the ‹N/M› pager has moved OUT into its
  // own protected slot (see RunHeader.Worklist placement), so this clip can only
  // ever bite the lowest-priority Left leaves (StageRail), never the pager. The
  // article title is the flex cushion; back/project/stages drop via @container
  // queries in priority order.
  return <div className={cn('flex min-w-0 shrink items-center gap-1.5 overflow-hidden @[48rem]/headerbar:gap-3')}>{children}</div>;
}
function Center({ children }: { children: ReactNode }) {
  // Lower priority than the Left identity + pager: reviewers + role chip drop via
  // @container queries (Reviewers/RoleChip own their thresholds) before the
  // article title is forced to truncate away — so "article > reviewer" holds.
  // overflow-hidden is the same anti-overlap backstop as Left.
  return <div className={cn('flex min-w-0 shrink items-center gap-2 overflow-hidden')}>{children}</div>;
}
function Right({ children }: { children: ReactNode }) {
  // `ml-auto` makes this cluster absorb all free space and pin right (the job
  // Left's `flex-1` used to do, minus the starvation). `shrink-0` so the
  // PrimaryAction is never clipped; only the inter-item gap tightens.
  return <div className={cn('ml-auto flex shrink-0 items-center gap-1 @[48rem]/headerbar:gap-2')}>{children}</div>;
}

function RunHeaderRoot({
  value,
  children,
}: {
  value: RunHeaderValue;
  children: ReactNode;
}) {
  return (
    <RunHeaderProvider value={value}>
      <TooltipProvider delayDuration={200}>
        {/* relative (not sticky): run pages don't scroll the header out — the
            body is a fixed-height panel split. Shadow stays off (border-only).
            HeaderShell owns the `@container/headerbar` + frosted chrome, so the
            consumer no longer wraps RunHeader in its own container div. */}
        <HeaderShell position="relative">
          {children}
        </HeaderShell>
      </TooltipProvider>
    </RunHeaderProvider>
  );
}

export const RunHeader = Object.assign(RunHeaderRoot, { Left, Center, Right, StageRail, PrimaryAction, PanelToggle, SidebarToggle, MobileNav, Help, RoleChip, Reviewers, Save: SaveSlot, AIActions, Breadcrumb, CompareToggle, Menu, MenuItem, Worklist, CommandPalette });
