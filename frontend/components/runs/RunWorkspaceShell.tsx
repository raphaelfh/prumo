import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SidebarProvider, useSidebar } from '@/contexts/SidebarContext';
import { ProjectSidebar } from '@/components/layout/ProjectSidebar';
import { MobileSidebar } from '@/components/layout/MobileSidebar';
import { useKeyboardShortcuts, type Binding } from '@/hooks/useKeyboardShortcuts';
import type { SidebarTabId } from '@/components/layout/sidebarConfig';

interface RunWorkspaceShellProps {
  projectId: string;
  activeTab: SidebarTabId;
  children: ReactNode;
}

function ShellInner({ projectId, activeTab, children }: RunWorkspaceShellProps) {
  const navigate = useNavigate();
  const { toggleSidebar, mobileOpen, setMobileOpen } = useSidebar();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  // Focus shell only wires ⌘B (sidebar). G-nav is out of scope here so the
  // sidebar nav items navigate OUT of focus mode to the project tab.
  const bindings: Binding[] = [{ type: 'chord', key: 'b', mod: true, handler: toggleSidebar }];
  useKeyboardShortcuts({ bindings, enabled: true });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Mobile nav drawer (Sheet) — the focus-mode phone hamburger
          (RunHeader Left, container < 34rem) opens this. ProjectSidebar is
          hidden below lg, so it is the only nav surface on phones. projectName
          is intentionally omitted, mirroring the ProjectSidebar call below. */}
      <MobileSidebar
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        activeTab={activeTab}
        onTabChange={(tab) => navigate(`/projects/${projectId}?tab=${tab}`)}
      />
      <div className="flex flex-1 overflow-hidden">
        {/* projectName is intentionally omitted: ProjectSidebar is unmounted
            while collapsed (the focus default), and SidebarHeader fetches the
            project list itself for the switcher when expanded. Fetching it here
            would be wasted work in the common collapsed case. */}
        <ProjectSidebar
          activeTab={activeTab}
          onTabChange={(tab) => navigate(`/projects/${projectId}?tab=${tab}`)}
          switcherOpen={switcherOpen}
          onSwitcherOpenChange={setSwitcherOpen}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

/**
 * Wraps a full-screen run page in the real app navigation sidebar, collapsed by
 * default for focus. The page's RunHeader is the bar (no Topbar). ⌘B and the
 * RunHeader.SidebarToggle both drive the same collapse state via SidebarContext.
 */
export function RunWorkspaceShell({ projectId, activeTab, children }: RunWorkspaceShellProps) {
  return (
    <SidebarProvider defaultCollapsed>
      <ShellInner projectId={projectId} activeTab={activeTab}>
        {children}
      </ShellInner>
    </SidebarProvider>
  );
}
