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
export const ProjectLayout: React.FC<AppLayoutProps> = ({ children, className }) => {
  const { project, activeTab, changeTab } = useProject();
    const {sidebarCollapsed, toggleSidebar, mobileOpen, setMobileOpen} = useSidebar();

  return (
    <div className={cn("h-screen flex flex-col overflow-hidden bg-background", className)}>
      {/* Topbar Fixo */}
      <div className="flex-shrink-0">
        <Topbar />
      </div>

        {/* Mobile Sidebar (Sheet) */}
        <MobileSidebar
            open={mobileOpen}
            onOpenChange={setMobileOpen}
            activeTab={activeTab}
            onTabChange={changeTab}
            projectName={project?.name}
        />

        {/* Main container: Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Fixo - Desktop */}
        <ProjectSidebar
          isCollapsed={sidebarCollapsed}
          activeTab={activeTab}
          onTabChange={changeTab}
          projectName={project?.name}
        />

          {/* Main content with its own scroll */}
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
