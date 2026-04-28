/**
 * Project-shell shortcuts: G+letter for nav, ⌘B for sidebar, ⌘K for project switcher.
 */
import {useMemo} from 'react';
import {useKeyboardShortcuts, type Binding} from './useKeyboardShortcuts';
import {sidebarItems, type SidebarTabId} from '@/components/layout/sidebarConfig';

interface UseNavigationShortcutsOptions {
  enabled: boolean;
  onNavigate: (tab: SidebarTabId) => void;
  onToggleSidebar: () => void;
  onOpenProjectSwitcher: () => void;
}

export function useNavigationShortcuts({enabled, onNavigate, onToggleSidebar, onOpenProjectSwitcher}: UseNavigationShortcutsOptions): void {
  const bindings: Binding[] = useMemo(() => {
    const navBindings: Binding[] = sidebarItems.map((item) => ({
      type: 'sequence',
      prefix: 'g',
      key: item.shortcut.toLowerCase(),
      handler: () => onNavigate(item.id),
    }));
    const chordBindings: Binding[] = [
      {type: 'chord', key: 'b', mod: true, handler: onToggleSidebar},
      {type: 'chord', key: 'k', mod: true, handler: onOpenProjectSwitcher},
    ];
    return [...navBindings, ...chordBindings];
  }, [onNavigate, onToggleSidebar, onOpenProjectSwitcher]);

  useKeyboardShortcuts({bindings, enabled});
}
