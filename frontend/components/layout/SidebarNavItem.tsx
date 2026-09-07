/**
 * Sidebar nav item: icon + label + optional shortcut badge.
 * See docs/superpowers/design-system/sidebar-and-panels.md §4.
 *
 * `shortcut` is the letter pressed AFTER the `G` prefix. It is optional
 * because the workspace rail's Settings item has no `G`-sequence: `⌘,` is
 * bound app-wide by `useGlobalShortcuts`, and a chip here would advertise a
 * binding this component neither registers nor owns.
 */
import React from 'react';
import type {LucideIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {KbdBadge} from '@/components/ui/kbd-badge';
import {cn} from '@/lib/utils';

interface SidebarNavItemProps {
  icon: LucideIcon;
  label: string;
  /** Letter pressed after `G`. Omit for an item with no sequence binding. */
  shortcut?: string;
  active: boolean;
  onClick: () => void;
}

export const SidebarNavItem: React.FC<SidebarNavItemProps> = ({
  icon: Icon,
  label,
  shortcut,
  active,
  onClick,
}) => (
  <Button
    variant="ghost"
    aria-current={active ? 'page' : undefined}
    aria-keyshortcuts={shortcut === undefined ? undefined : `G ${shortcut}`}
    onClick={onClick}
    className={cn(
      'w-full justify-start gap-2.5 h-7 px-2.5 rounded-md transition-colors duration-75 group',
      active
        ? 'bg-muted text-foreground font-medium'
        : 'text-muted-foreground/80 hover:bg-muted/50 hover:text-foreground',
    )}
  >
    <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-foreground' : 'group-hover:text-foreground/80')} strokeWidth={1.5} />
    <span className="text-[13px] flex-1 text-left truncate">{label}</span>
    {shortcut !== undefined && (
      <KbdBadge
        keys={['G', shortcut]}
        variant="sequence"
        className="opacity-0 transition-opacity duration-75 group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    )}
  </Button>
);

