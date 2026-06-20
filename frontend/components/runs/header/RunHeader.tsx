import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { RunHeaderProvider, type RunHeaderValue } from './RunHeaderContext';
import { StageRail } from './StageRail';
import { PrimaryAction } from './PrimaryAction';
import { PanelToggle } from './PanelToggle';
import { RoleChip } from './RoleChip';
import { Reviewers } from './Reviewers';
import { SaveSlot } from './SaveSlot';
import { AIActions } from './AIActions';
import { Breadcrumb } from './Breadcrumb';
import { Menu, MenuItem } from './Menu';
import { Worklist } from './Worklist';

function Left({ children }: { children: ReactNode }) {
  return <div className={cn('flex min-w-0 flex-1 items-center gap-3')}>{children}</div>;
}
function Center({ children }: { children: ReactNode }) {
  return <div className={cn('flex shrink-0 items-center gap-2')}>{children}</div>;
}
function Right({ children }: { children: ReactNode }) {
  return <div className={cn('flex shrink-0 items-center gap-2')}>{children}</div>;
}

function RunHeaderRoot({ value, children }: { value: RunHeaderValue; children: ReactNode }) {
  return (
    <RunHeaderProvider value={value}>
      <header className="relative z-10 border-b border-border/40 bg-background/80 backdrop-blur-md">
        <div className="flex h-12 items-center gap-4 px-6">{children}</div>
      </header>
    </RunHeaderProvider>
  );
}

export const RunHeader = Object.assign(RunHeaderRoot, { Left, Center, Right, StageRail, PrimaryAction, PanelToggle, RoleChip, Reviewers, Save: SaveSlot, AIActions, Breadcrumb, Menu, MenuItem, Worklist });
