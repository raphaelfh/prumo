/**
 * The shell's top bar: panel toggle / hamburger + breadcrumb (left),
 * SectionViewSwitcher (centre), NotificationCenter (right).
 *
 * `isProjectPage` used to be read from `window.location`, which never
 * re-rendered on client navigation. That survived only because `/` and
 * `/projects/:id` were separate route trees that remounted the bar; inside
 * AppShell the bar no longer remounts, so the read is now `useShellLocation()`
 * (ledger 2026-09-07T14:33Z — not optional).
 *
 * HeaderShell is kept verbatim: `h-12`, sticky, frosted, `z-header`, and the
 * `@container/headerbar` declaration that the breadcrumb's info button and
 * both SectionViewSwitcher tiers key off.
 */

import React from 'react';
import {Menu} from 'lucide-react';
import {HeaderIconButton} from '@/components/layout/HeaderIconButton';
import {useUserProfile} from '@/hooks/useNavigation';
import {useSidebar} from '@/contexts/SidebarContext';
import {useHeaderActions} from '@/contexts/HeaderActionsContext';
import {HeaderShell} from '@/components/layout/HeaderShell';
import {PanelToggleButton} from '@/components/layout/PanelToggleButton';
import {useScrolled} from '@/components/layout/useScrolled';
import {NotificationCenter} from './NotificationCenter';
import {AppBreadcrumb} from './Breadcrumb';
import type {TopbarProps} from '@/types/navigation';
import {t} from '@/lib/copy';
import {SectionViewSwitcher} from '@/components/navigation/SectionViewSwitcher';

export const Topbar: React.FC<TopbarProps> = ({className}) => {
  const {isLoading} = useUserProfile();
  const scrolled = useScrolled();
  const {sidebarCollapsed, toggleSidebar, toggleMobile} = useSidebar();
  // Read directly here, not off a prop from a memoized ancestor — the
  // documented React Compiler hazard for a subscription like this one.
  const headerActions = useHeaderActions();

  // Loading state: skeleton with final content dimensions to avoid layout
  // shift. Routed through HeaderShell so it shares the exact final chrome.
  if (isLoading) {
    return (
      <HeaderShell className={className}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="h-5 w-5 shrink-0 animate-pulse rounded bg-muted" />
          <div className="h-[13px] w-28 shrink-0 animate-pulse rounded bg-muted" />
        </div>
      </HeaderShell>
    );
  }

  return (
    <HeaderShell lifted={scrolled} className={className}>
      {/* Left — toggles + breadcrumb (min-w-0 so the crumbs can truncate) */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <HeaderIconButton
          onClick={toggleMobile}
          aria-label={t('navigation', 'ariaOpenMenu')}
          className="lg:hidden"
        >
          <Menu strokeWidth={1.5} aria-hidden="true" />
        </HeaderIconButton>
        <span className="hidden lg:flex">
          <PanelToggleButton
            side="left"
            pressed={!sidebarCollapsed}
            onToggle={toggleSidebar}
            ariaLabel={t('layout', 'sidebarToggleAriaLabel')}
          />
        </span>
        <AppBreadcrumb />
      </div>

      {/* Centre — view switcher (yields width so the crumbs can truncate) */}
      <div className="flex shrink-0 items-center justify-center">
        <SectionViewSwitcher />
      </div>

      {/* Right — notifications, then whatever the current page slots in
          (e.g. the Articles panel toggle) immediately to their right. */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        <NotificationCenter />
        {headerActions}
      </div>
    </HeaderShell>
  );
};
