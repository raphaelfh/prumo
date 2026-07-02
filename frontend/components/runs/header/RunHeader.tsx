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
 * RESPONSIVE CASCADE (3 rules — the RunStatus popover absorbed the old
 * stage-rail / reviewers / role-chip fold ladder):
 *
 *   1. The article title truncates (pure flex-shrink) — never drops.
 *   2. Reviewer avatars drop <48rem (RunStatus.tsx).
 *   3. Back arrow drops <42rem (Breadcrumb.tsx); the stage chip folds to its
 *      dot <36rem but NEVER drops — it is the status anchor.
 *
 * The ‹N/M› pager keeps its own protected shrink-0 slot; Left/Center keep
 * overflow-hidden purely as an anti-overlap backstop for whitespace-nowrap
 * leaves.
 */
function Left({ children }: { children: ReactNode }) {
  // Identity track. It SHRINKS (the breadcrumb title truncates) and keeps
  // `overflow-hidden` ONLY as an anti-overlap backstop: its leaves are
  // `whitespace-nowrap`, so without it a shrunk track would paint its text on
  // top of the next slot. The ‹N/M› pager lives OUT in its own protected slot
  // (see RunHeader.Worklist placement), so a clip can never bite it. The
  // article title is the flex cushion; the back arrow drops via @container.
  return <div className={cn('flex min-w-0 shrink items-center gap-1.5 overflow-hidden @[48rem]/headerbar:gap-3')}>{children}</div>;
}
function Center({ children }: { children: ReactNode }) {
  // Status track (RunStatus cluster). The avatar stack drops <48rem inside
  // RunStatus; the stage chip never drops. overflow-hidden is the same
  // anti-overlap backstop as Left.
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

export const RunHeader = Object.assign(RunHeaderRoot, { Left, Center, Right, RunStatus, PrimaryAction, PanelToggle, SidebarToggle, MobileNav, Help, Save: SaveSlot, AIActions, Breadcrumb, CompareToggle, Menu, MenuItem, Worklist, CommandPalette });
