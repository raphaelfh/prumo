/**
 * Project sidebar: header (project switcher) + sections + footer.
 * Uses ResizablePanel for show/hide-binary + drag resize.
 * See docs/superpowers/design-system/sidebar-and-panels.md
 */
import React from 'react';
import {ResizablePanel} from '@/components/ui/resizable-panel';
import {SidebarContent} from './SidebarContent';
import {SidebarRail} from './SidebarRail';
import {type SidebarTabId} from './sidebarConfig';
import {useSidebar} from '@/contexts/SidebarContext';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

interface ProjectSidebarProps {
  activeTab: string;
  onTabChange: (tab: SidebarTabId) => void;
  projectName?: string;
  switcherOpen?: boolean;
  onSwitcherOpenChange?: (open: boolean) => void;
  className?: string;
  /**
   * Enable the collapsed mini-rail + hover-peek (main sidebar only). When off
   * (the per-article focus shell), collapse stays a true width-0 unmount for
   * max canvas. See docs/superpowers/design-system/sidebar-and-panels.md §1.
   */
  rail?: boolean;
}

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  activeTab,
  onTabChange,
  projectName,
  switcherOpen,
  onSwitcherOpenChange,
  className,
  rail,
}) => {
  const {sidebarCollapsed, toggleSidebar} = useSidebar();

  const content = (
    <SidebarContent
      activeTab={activeTab}
      onTabChange={onTabChange}
      projectName={projectName}
      switcherOpen={switcherOpen}
      onSwitcherOpenChange={onSwitcherOpenChange}
    />
  );

  // Rail mode: collapsed shows the 56px mini-rail with hover-peek; expanded is
  // the normal resizable panel (pin via ⌘B). Without `rail`, collapse remains a
  // true width-0 unmount (the focus shell).
  if (rail && sidebarCollapsed) {
    return <SidebarRail>{content}</SidebarRail>;
  }

  return (
    <ResizablePanel
      id="sidebar"
      side="right"
      defaultWidth={280}
      minWidth={240}
      maxWidth={400}
      snapCollapseAt={150}
      collapsed={rail ? false : sidebarCollapsed}
      onCollapse={toggleSidebar}
      tooltipLabel={t('layout', 'resizeHandleTooltip')}
      shortcut={['mod', 'B']}
      className={cn(
        'bg-[#fafafa] dark:bg-[#0c0c0c] border-r border-border/40 hidden lg:block',
        className,
      )}
    >
      {content}
    </ResizablePanel>
  );
};

export default ProjectSidebar;
