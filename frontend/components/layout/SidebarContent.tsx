/**
 * Inner sidebar tree: header (switcher) + nav sections + footer.
 * Shared by the full ProjectSidebar (inside ResizablePanel) and the collapsed
 * SidebarRail's peek overlay, so labels/shortcuts/active-state have one source
 * of truth. Inside a collapsed rail (a `group/rail` with data-peek="closed"),
 * the text degrades to icon-only via rail-aware classes on the child rows;
 * those classes are inert here (no group/rail ancestor).
 * See docs/superpowers/design-system/sidebar-and-panels.md
 */
import React from 'react';
import {SidebarHeader} from './SidebarHeader';
import {SidebarSection} from './SidebarSection';
import {SidebarNavItem} from './SidebarNavItem';
import {SidebarFooter} from './SidebarFooter';
import {sidebarSections, type SidebarTabId} from './sidebarConfig';

interface SidebarContentProps {
  activeTab: string;
  onTabChange: (tab: SidebarTabId) => void;
  projectName?: string;
  switcherOpen?: boolean;
  onSwitcherOpenChange?: (open: boolean) => void;
}

export const SidebarContent: React.FC<SidebarContentProps> = ({
  activeTab,
  onTabChange,
  projectName,
  switcherOpen,
  onSwitcherOpenChange,
}) => (
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
);

export default SidebarContent;
