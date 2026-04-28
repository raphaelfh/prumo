/**
 * Project sidebar: header (project switcher) + sections + footer.
 * Uses ResizablePanel for show/hide-binary + drag resize.
 * See docs/superpowers/design-system/sidebar-and-panels.md
 */
import React from 'react';
import {ResizablePanel} from '@/components/ui/resizable-panel';
import {SidebarHeader} from './SidebarHeader';
import {SidebarSection} from './SidebarSection';
import {SidebarNavItem} from './SidebarNavItem';
import {SidebarFooter} from './SidebarFooter';
import {sidebarSections, type SidebarTabId} from './sidebarConfig';
import {useSidebar} from '@/contexts/SidebarContext';
import {cn} from '@/lib/utils';

interface ProjectSidebarProps {
  activeTab: string;
  onTabChange: (tab: SidebarTabId) => void;
  projectName?: string;
  switcherOpen?: boolean;
  onSwitcherOpenChange?: (open: boolean) => void;
  className?: string;
}

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  activeTab,
  onTabChange,
  projectName,
  switcherOpen,
  onSwitcherOpenChange,
  className,
}) => {
  const {sidebarCollapsed, toggleSidebar} = useSidebar();

  return (
    <ResizablePanel
      id="sidebar"
      side="right"
      defaultWidth={280}
      minWidth={240}
      maxWidth={400}
      snapCollapseAt={150}
      collapsed={sidebarCollapsed}
      onCollapse={toggleSidebar}
      className={cn(
        'bg-[#fafafa] dark:bg-[#0c0c0c] border-r border-border/40 hidden lg:block',
        className,
      )}
    >
      <div className="flex flex-col h-full">
        <SidebarHeader projectName={projectName} open={switcherOpen} onOpenChange={onSwitcherOpenChange} />
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {sidebarSections.map((section) => (
            <SidebarSection key={section.title} title={section.title}>
              {section.items.map((item) => (
                <SidebarNavItem
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  shortcut={item.shortcut}
                  active={activeTab === item.id}
                  onClick={() => onTabChange(item.id)}
                />
              ))}
            </SidebarSection>
          ))}
        </nav>
        <SidebarFooter />
      </div>
    </ResizablePanel>
  );
};

export default ProjectSidebar;
