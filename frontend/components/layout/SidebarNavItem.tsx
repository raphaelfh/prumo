/**
 * Sidebar nav item: icon + label + shortcut badge.
 * See docs/superpowers/design-system/sidebar-and-panels.md §4.
 */
import React from 'react';
import type {LucideIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {KbdBadge} from '@/components/ui/kbd-badge';
import {cn} from '@/lib/utils';

interface SidebarNavItemProps {
  icon: LucideIcon;
  label: string;
  shortcut: string;
  active: boolean;
  onClick: () => void;
}

export const SidebarNavItem: React.FC<SidebarNavItemProps> = ({icon: Icon, label, shortcut, active, onClick}) => (
  <Button
    variant="ghost"
    aria-current={active ? 'page' : undefined}
    aria-keyshortcuts={`G ${shortcut}`}
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
    <KbdBadge keys={[shortcut]} className="opacity-60 group-hover:opacity-100" />
  </Button>
);

export default SidebarNavItem;
