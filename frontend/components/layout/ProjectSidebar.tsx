/**
 * The app sidebar: one ResizablePanel, two states.
 *
 * - project open  → project switcher header + today's project sections
 * - no project    → brand header + a WORKSPACE section
 *
 * Both states keep SidebarFooter, which is what makes the account menu, theme
 * toggle and feedback button reachable from the hub (spec §4).
 *
 * The two states' item lists come from `deriveSidebarNav`, shared with
 * MobileSidebar — this file owns chrome, not branching.
 *
 * Navigation writes the URL rather than calling a prop-drilled `onTabChange`;
 * ProjectContext already syncs `activeTab` FROM the URL during render, so it
 * follows without change (spec §3.2, asserted in
 * `frontend/test/projectSectionNav.test.tsx`). `activeTab` stays a prop
 * because the full-screen run routes have no `?tab=` to derive it from.
 *
 * See docs/superpowers/design-system/sidebar-and-panels.md (§2 sizing:
 * 280 / 240 / 400 / 150).
 */
import React from 'react';
import {useLocation, useNavigate} from 'react-router';
import {ResizablePanel} from '@/components/ui/resizable-panel';
import {SidebarHeader} from './SidebarHeader';
import {SidebarBrandHeader} from './SidebarBrandHeader';
import {SidebarSection} from './SidebarSection';
import {SidebarNavItem} from './SidebarNavItem';
import {SidebarFooter} from './SidebarFooter';
import {deriveSidebarNav} from './sidebarConfig';
import {useSidebar} from '@/contexts/SidebarContext';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

interface ProjectSidebarProps {
  /** Null on `/` and `/settings`: the sidebar renders its workspace state. */
  projectId: string | null;
  activeTab: string;
  projectName?: string;
  switcherOpen?: boolean;
  onSwitcherOpenChange?: (open: boolean) => void;
  className?: string;
}

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  projectId,
  activeTab,
  projectName,
  switcherOpen,
  onSwitcherOpenChange,
  className,
}) => {
  const {sidebarCollapsed, toggleSidebar} = useSidebar();
  const navigate = useNavigate();
  const {pathname} = useLocation();
  const groups = deriveSidebarNav({projectId, activeTab, pathname});

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
      tooltipLabel={t('layout', 'resizeHandleTooltip')}
      shortcut={['mod', 'B']}
      className={cn(
        'bg-[#fafafa] dark:bg-[#0c0c0c] border-r border-border/40 hidden lg:block',
        className,
      )}
    >
      <div className="flex flex-col h-full">
        {projectId !== null ? (
          <SidebarHeader projectName={projectName} open={switcherOpen} onOpenChange={onSwitcherOpenChange} />
        ) : (
          <SidebarBrandHeader />
        )}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {groups.map((group) => (
            <SidebarSection key={group.title} title={group.title}>
              {group.items.map((item) => (
                <SidebarNavItem
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  shortcut={item.shortcut}
                  active={item.active}
                  onClick={() => navigate(item.path)}
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
