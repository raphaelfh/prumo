import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HeaderShell } from '@/components/layout/HeaderShell';
import { RunHeaderProvider, type RunHeaderValue } from './RunHeaderContext';
import { RunStatus } from './RunStatus';
import { PrimaryAction } from './PrimaryAction';
import { PanelToggle } from './PanelToggle';
import { SidebarToggle } from './SidebarToggle';
import { MobileNav } from './MobileNav';
import { Help } from './Help';
import { SaveSlot } from './SaveSlot';
import { AIActions } from './AIActions';
import { Breadcrumb } from './Breadcrumb';
import { CompareToggle } from './CompareToggle';
import { Menu, MenuItem } from './Menu';
import { Worklist } from './Worklist';
import { CommandPalette } from './CommandPalette';

/**
 * LAYOUT — Identity | Navigation | Controls & Status.
 *
 * Centring is a free-space split: `Left` and `Right` are both
 * `flex: 1 1 0%`, so the space either side of the `shrink-0` `Center` track is
 * even and the article pager lands on the geometric centre. `Right` has no
 * `min-w-0`, so it floors at min-content: when the control cluster genuinely
 * outgrows its half it pushes, and the pager slides left. Nothing here is
 * absolutely positioned, so overlap is impossible by construction.
 *
 * RESPONSIVE CASCADE, by header container width:
 *
 *   >= 64rem  everything visible; pager on the exact centre.
 *   48-64rem  RunStatus reviewer avatars drop (RunStatus.tsx) — they can only
 *             hide, never shrink, so they fold first in the packed consensus
 *             config.
 *   42-48rem  Breadcrumb back arrow drops (Breadcrumb.tsx). The stage chip
 *             folds to its dot < 58rem but NEVER drops — it is the status
 *             anchor.
 *   < 42rem   The pager stays INTACT — it is the highest-priority navigation.
 *             The article title truncates; it is the designated flex cushion.
 *
 *   Single-article worklist: Worklist renders null and the centre is empty.
 */
function Left({ children }: { children: ReactNode }) {
  // Identity track. Grows from a 0 basis with weight 1 (see Center), and keeps
  // `overflow-hidden` ONLY as an anti-overlap backstop: its leaves are
  // `whitespace-nowrap`, so without it a shrunk track would paint its text on
  // top of the next slot. The article title is the flex cushion — it truncates
  // and never drops.
  return <div className={cn('flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden @[48rem]/headerbar:gap-3')}>{children}</div>;
}
function Center({ children }: { children: ReactNode }) {
  // Navigation track (the article pager). `shrink-0` so it is never clipped.
  // Left and Right both have `flex-basis: 0` and `flex-grow: 1`, so the free
  // space either side of this track is split evenly — that is what centres it.
  return <div data-testid="run-header-center" className={cn('flex shrink-0 items-center gap-2')}>{children}</div>;
}
function Right({ children }: { children: ReactNode }) {
  // Controls + status track. Grows symmetrically with Left, `justify-end` to
  // pin its content right. Deliberately WITHOUT `min-w-0`: the automatic
  // `min-width: auto` floors it at min-content, which is what guarantees
  // PrimaryAction is never clipped. When the cluster genuinely outgrows its
  // half, it pushes and the pager slides left rather than overlapping.
  return <div className={cn('flex flex-1 items-center justify-end gap-1 @[48rem]/headerbar:gap-2')}>{children}</div>;
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

export const RunHeader = Object.assign(RunHeaderRoot, { Left, Center, Right, RunStatus, PrimaryAction, PanelToggle, SidebarToggle, MobileNav, Help, Save: SaveSlot, AIActions, Breadcrumb, CompareToggle, Menu, MenuItem, Worklist, CommandPalette });
