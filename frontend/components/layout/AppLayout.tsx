/**
 * Main application layout
 * Integrates Topbar, Sidebar and content area
 */

import React from 'react';
import {Outlet} from 'react-router-dom';
import {Topbar} from '@/components/navigation';
import {ProjectSidebar} from './ProjectSidebar';
import {MobileSidebar} from './MobileSidebar';
import {useProject} from '@/contexts/ProjectContext';
import {useSidebar} from '@/contexts/SidebarContext';
import {useNavigationShortcuts} from '@/hooks/useNavigationShortcuts';
import type {SidebarTabId} from './sidebarConfig';
import {cn} from '@/lib/utils';

interface AppLayoutProps {
  children?: React.ReactNode;
  className?: string;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children, className }) => {
  return (
    <div className={cn("min-h-screen bg-background", className)}>
      {/* Topbar Global */}
      <Topbar />
      
      {/* Main Content Area */}
      <main className="flex-1">
        {children || <Outlet />}
      </main>
    </div>
  );
};

// Layout with Sidebar for specific pages
export const ProjectLayout: React.FC<AppLayoutProps> = ({children, className}) => {
  const {project, activeTab, changeTab} = useProject();
  const {toggleSidebar, mobileOpen, setMobileOpen} = useSidebar();
  const [switcherOpen, setSwitcherOpen] = React.useState(false);

  const handleNavigate = React.useCallback((tab: SidebarTabId) => changeTab(tab), [changeTab]);

  useNavigationShortcuts({
    enabled: true,
    onNavigate: handleNavigate,
    onToggleSidebar: toggleSidebar,
    onOpenProjectSwitcher: () => setSwitcherOpen(true),
  });

  return (
    <div className={cn('h-screen flex flex-col overflow-hidden bg-background', className)}>
      <div className="flex-shrink-0">
        <Topbar />
      </div>

      <MobileSidebar
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        activeTab={activeTab}
        onTabChange={changeTab}
        projectName={project?.name}
      />

      <div className="flex flex-1 overflow-hidden">
        <ProjectSidebar
          activeTab={activeTab}
          onTabChange={changeTab}
          projectName={project?.name}
          switcherOpen={switcherOpen}
          onSwitcherOpenChange={setSwitcherOpen}
        />
        <main className="flex-1 overflow-y-auto">
          {children || <Outlet />}
        </main>
      </div>
    </div>
  );
};

// Simple layout for auth pages
export const AuthLayout: React.FC<AppLayoutProps> = ({ children, className }) => {
  return (
    <div className={cn("min-h-screen bg-background flex items-center justify-center p-4", className)}>
      <div className="w-full max-w-md">
        {children || <Outlet />}
      </div>
    </div>
  );
};

export default AppLayout;
