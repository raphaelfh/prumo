import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SidebarProvider, useSidebar } from '@/contexts/SidebarContext';
import { ProjectSidebar } from '@/components/layout/ProjectSidebar';
import { useProjectsList } from '@/hooks/useProjectsList';
import { useKeyboardShortcuts, type Binding } from '@/hooks/useKeyboardShortcuts';
import type { SidebarTabId } from '@/components/layout/sidebarConfig';

interface RunWorkspaceShellProps {
  projectId: string;
  activeTab: SidebarTabId;
  children: ReactNode;
}

function ShellInner({ projectId, activeTab, children }: RunWorkspaceShellProps) {
  const navigate = useNavigate();
  const { toggleSidebar } = useSidebar();
  const { projects } = useProjectsList();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const projectName = projects.find((p) => p.id === projectId)?.name;

  // Focus shell only wires ⌘B (sidebar). G-nav is out of scope here so the
  // sidebar nav items navigate OUT of focus mode to the project tab.
  const bindings: Binding[] = [{ type: 'chord', key: 'b', mod: true, handler: toggleSidebar }];
  useKeyboardShortcuts({ bindings, enabled: true });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <div className="flex flex-1 overflow-hidden">
        <ProjectSidebar
          activeTab={activeTab}
          onTabChange={(tab) => navigate(`/projects/${projectId}?tab=${tab}`)}
          projectName={projectName}
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
