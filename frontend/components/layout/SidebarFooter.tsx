/**
 * Sidebar footer: user menu (left, fills) + theme toggle (right).
 */
import React from 'react';
import {ThemeToggle} from './ThemeToggle';
import {UserMenu} from './UserMenu';

export const SidebarFooter: React.FC = () => (
  <div className="border-t border-border/40 p-2 flex items-center gap-1">
    <div className="flex-1 min-w-0">
      <UserMenu />
    </div>
    <ThemeToggle />
  </div>
);

export default SidebarFooter;
