/**
 * Main Topbar component
 * Integrates all top navigation elements
 */

import React, {useContext, useState} from 'react';
import {Info, Menu} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {useUserProfile} from '@/hooks/useNavigation';
import {SidebarContext} from '@/contexts/SidebarContext';
import {ProjectContext} from '@/contexts/ProjectContext';
import {FeedbackButton} from '@/components/feedback/FeedbackButton';
import {HeaderShell} from '@/components/layout/HeaderShell';
import {PanelToggleButton} from '@/components/layout/PanelToggleButton';
import {useScrolled} from '@/components/layout/useHeaderTier';
import {TruncatedText} from '@/components/runs/header/TruncatedText';
import {NotificationCenter} from './NotificationCenter';
import type {TopbarProps} from '@/types/navigation';
import {tabIdToLabel} from '@/components/layout/sidebarConfig';
import {t} from '@/lib/copy';
import {SectionViewSwitcher} from '@/components/navigation/SectionViewSwitcher';
import {sectionDescriptionKey} from '@/components/layout/sectionViews';

export const Topbar: React.FC<TopbarProps> = ({
  className,
}) => {
  const { user, isLoading } = useUserProfile();
  const [_mobileMenuOpen, _setMobileMenuOpen] = useState(false);
  const scrolled = useScrolled();

  // Use sidebar context only on project pages
  // IMPORTANT: Hooks must always be called unconditionally
  // Use useContext directly to avoid errors when contexts are not available
  const isProjectPage = window.location.pathname.includes('/projects/');

  // Always call useContext unconditionally (does not violate React rules)
  const sidebarContextValue = useContext(SidebarContext);
  const projectContextValue = useContext(ProjectContext);

  // Use only when available and on project page
  const sidebarContext = (isProjectPage && sidebarContextValue !== undefined) ? sidebarContextValue : null;
  const projectContext = (isProjectPage && projectContextValue !== undefined) ? projectContextValue : null;

  // Loading state: skeleton with final content dimensions to avoid layout shift.
  // Routed through HeaderShell so the skeleton shares the exact final chrome.
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

  // If no user, render simplified topbar (same final chrome via HeaderShell).
  if (!user) {
    return (
      <HeaderShell className={className}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-header-title font-medium text-foreground">{t('navigation', 'topbarBrand')}</span>
        </div>
        <FeedbackButton />
      </HeaderShell>
    );
  }

  return (
    <HeaderShell lifted={scrolled} className={className}>
      {/* Left Section — toggle + title (min-w-0 so the title can truncate) */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* Hamburger Menu — Mobile/Tablet only */}
        {sidebarContext && isProjectPage && (
          <Button
            variant="ghost"
            size="icon"
            onClick={sidebarContext.toggleMobile}
            aria-label={t('navigation', 'ariaOpenMenu')}
            className="flex h-8 w-8 shrink-0 transition-colors duration-75 hover:bg-muted/50 lg:hidden"
          >
            <Menu className="h-4 w-4 text-muted-foreground" />
          </Button>
        )}
        {/* Sidebar Toggle — Desktop only. */}
        {sidebarContext && isProjectPage && (
          <span className="hidden lg:flex">
            <PanelToggleButton
              side="left"
              pressed={!sidebarContext.sidebarCollapsed}
              onToggle={sidebarContext.toggleSidebar}
              ariaLabel={t('layout', 'sidebarToggleAriaLabel')}
            />
          </span>
        )}

        {/* Breadcrumb or Brand */}
        {!isProjectPage ? (
          <div className="flex items-center gap-2 px-2">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-primary">
              <span className="text-[10px] font-bold text-primary-foreground">R</span>
            </div>
            <span className="text-header-title font-medium tracking-tight text-foreground">
              {t('navigation', 'topbarBrandFull')}
            </span>
          </div>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 px-2">
            <TruncatedText
              className="text-header-title font-medium text-foreground"
              text={tabIdToLabel[projectContext?.activeTab ?? ''] ?? t('layout', 'defaultProjectName')}
            />
            {sectionDescriptionKey[projectContext?.activeTab ?? ''] && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="hidden text-muted-foreground/60 transition-colors hover:text-foreground @[34rem]/headerbar:inline-flex"
                      aria-label={t('navigation', sectionDescriptionKey[projectContext?.activeTab ?? ''])}
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('navigation', sectionDescriptionKey[projectContext?.activeTab ?? ''])}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </span>
        )}
      </div>

      {/* Center Section — View Switcher (yields width so the title can truncate) */}
      <div className="flex shrink-0 items-center justify-center">
        {isProjectPage && <SectionViewSwitcher />}
      </div>

      {/* Right Section — Notifications + Feedback */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        <NotificationCenter />
        <FeedbackButton />
      </div>
    </HeaderShell>
  );
};

export default Topbar;
