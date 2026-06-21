import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TooltipProvider } from '@/components/ui/tooltip';
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
import { Menu, MenuItem } from './Menu';
import { Worklist } from './Worklist';
import { CommandPalette } from './CommandPalette';

function Left({ children }: { children: ReactNode }) {
  // overflow-hidden is the backstop: even after the shrinkable children
  // (Breadcrumb truncates, StageRail clips) compress, content can never paint
  // out of this track onto the Center slot — the narrow-width overlap bug.
  return <div className={cn('flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden @[48rem]/headerbar:gap-3')}>{children}</div>;
}
function Center({ children }: { children: ReactNode }) {
  // Mid-priority (reviewers + role chip). Allowed to shrink/clip so it yields
  // room to Left instead of forcing overflow; its leaves collapse their labels
  // via @container queries before any clipping engages.
  return <div className={cn('flex min-w-0 shrink items-center gap-2 overflow-hidden')}>{children}</div>;
}
function Right({ children }: { children: ReactNode }) {
  // Stays shrink-0 so the PrimaryAction is never clipped; only the inter-item
  // gap tightens at narrow widths.
  return <div className={cn('flex shrink-0 items-center gap-1 @[48rem]/headerbar:gap-2')}>{children}</div>;
}

function RunHeaderRoot({ value, children }: { value: RunHeaderValue; children: ReactNode }) {
  return (
    <RunHeaderProvider value={value}>
      <TooltipProvider delayDuration={200}>
        <header className="relative z-10 border-b border-border/40 bg-background/80 backdrop-blur-md">
          <div className="flex h-12 items-center gap-2 px-3 @[40rem]/headerbar:gap-4 @[40rem]/headerbar:px-6">{children}</div>
        </header>
      </TooltipProvider>
    </RunHeaderProvider>
  );
}

export const RunHeader = Object.assign(RunHeaderRoot, { Left, Center, Right, StageRail, PrimaryAction, PanelToggle, SidebarToggle, MobileNav, Help, RoleChip, Reviewers, Save: SaveSlot, AIActions, Breadcrumb, Menu, MenuItem, Worklist, CommandPalette });
