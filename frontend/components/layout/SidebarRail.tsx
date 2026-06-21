/**
 * Collapsed mini-rail: a 56px icon column that peeks to 256px (overlaying the
 * content, never reflowing it) on hover or keyboard focus, then settles back.
 *
 * It hosts the SAME SidebarContent as the expanded sidebar, so there is one set
 * of focusable nav buttons (no duplicate tab stops). Rail-aware classes on the
 * content's text (group-data-[peek=closed]/rail:opacity-0) degrade it to
 * icon-only while collapsed and reveal labels on peek; the 56px aside clips the
 * 256px-wide inner via overflow-hidden so rows never reflow as it widens.
 *
 * Main sidebar only — the per-article focus shell opts out (stays width-0).
 * See docs/superpowers/design-system/sidebar-and-panels.md §1, §8.
 */
import React from 'react';
import {useSidebarPeek} from '@/hooks/useSidebarPeek';
import {cn} from '@/lib/utils';

interface SidebarRailProps {
  /** A <SidebarContent /> — the shared inner tree. */
  children: React.ReactNode;
  className?: string;
}

export const SidebarRail: React.FC<SidebarRailProps> = ({children, className}) => {
  const {open, onEnter, onLeave, openNow, closeNow} = useSidebarPeek();

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Esc dismisses the peek without moving the pointer (WCAG 1.4.13).
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      closeNow();
    }
  };

  return (
    // In-flow 56px slot reserves the rail's column; the rail/peek floats over `main`.
    <div className="relative w-14 shrink-0 hidden lg:block">
      <aside
        data-peek={open ? 'open' : 'closed'}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onFocus={openNow}
        onBlur={onLeave}
        onKeyDown={onKeyDown}
        className={cn(
          'group/rail absolute inset-y-0 left-0 z-20 overflow-hidden',
          'bg-[#fafafa] dark:bg-[#0c0c0c] border-r border-border/40',
          'transition-[width,box-shadow] duration-[180ms] ease-out motion-reduce:duration-0',
          open ? 'w-64 shadow-elev-popover' : 'w-14',
          className,
        )}
      >
        {/* Fixed open-width inner so rows never reflow as the rail widens. */}
        <div className="h-full w-64">{children}</div>
      </aside>
    </div>
  );
};

export default SidebarRail;
