/**
 * Sidebar section: uppercase title + items.
 * See docs/superpowers/design-system/sidebar-and-panels.md §5.
 */
import React from 'react';

interface SidebarSectionProps {
  title: string;
  children: React.ReactNode;
}

export const SidebarSection: React.FC<SidebarSectionProps> = ({title, children}) => (
  <div>
    <div className="px-2.5 pb-1 pt-2">
      <span className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider select-none">
        {title}
      </span>
    </div>
    {children}
  </div>
);

export default SidebarSection;
