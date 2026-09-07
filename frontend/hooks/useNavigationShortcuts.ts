/**
 * Shell shortcuts.
 *
 * Workspace bindings (`⌘B`, `G H`) are active on every shell route; project
 * bindings (`G <letter>` per section, `G P` for the switcher) only when a
 * project id matched (spec §4.1). Navigation writes the URL — the sidebar and
 * these bindings now share one code path.
 *
 * `⌘,` (settings) and `⌘⇧Q` (sign out) stay in useGlobalShortcuts, which is
 * mounted outside Routes and already works everywhere.
 */
import {useNavigate} from 'react-router';
import {useKeyboardShortcuts, type Binding} from './useKeyboardShortcuts';
import {sidebarItems} from '@/components/layout/sidebarConfig';

interface UseNavigationShortcutsOptions {
  /** Null on `/` and `/settings`: project bindings are not registered. */
  projectId: string | null;
  onToggleSidebar: () => void;
  onOpenProjectSwitcher: () => void;
}

export function useNavigationShortcuts({
  projectId,
  onToggleSidebar,
  onOpenProjectSwitcher,
}: UseNavigationShortcutsOptions): void {
  const navigate = useNavigate();

  const workspaceBindings: Binding[] = [
    {type: 'chord', key: 'b', mod: true, handler: onToggleSidebar},
    {type: 'sequence', prefix: 'g', key: 'h', handler: () => navigate('/')},
  ];

  const projectBindings: Binding[] = projectId === null
    ? []
    : [
        ...sidebarItems.map((item): Binding => ({
          type: 'sequence',
          prefix: 'g',
          key: item.shortcut.toLowerCase(),
          handler: () => navigate(`/projects/${projectId}?tab=${item.id}`),
        })),
        {type: 'sequence', prefix: 'g', key: 'p', handler: onOpenProjectSwitcher},
      ];

  useKeyboardShortcuts({bindings: [...workspaceBindings, ...projectBindings], enabled: true});
}
