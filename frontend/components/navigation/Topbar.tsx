/**
 * Main Topbar component
 * Integrates all top navigation elements
 */

import React, {useContext, useState} from 'react';
import {Info, Menu, PanelLeftClose, PanelLeftOpen} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';
import {useUserProfile} from '@/hooks/useNavigation';
import {SidebarContext} from '@/contexts/SidebarContext';
import {ProjectContext} from '@/contexts/ProjectContext';
import {FeedbackButton} from '@/components/feedback/FeedbackButton';
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

    // Loading state: skeleton with final content dimensions to avoid layout shift
  if (isLoading) {
    return (
        <header
            className={cn("sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-md", className)}>
            <div className="flex h-12 w-full items-center justify-between px-4 sm:px-6">
                <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="h-5 w-5 rounded bg-muted animate-pulse shrink-0"/>
              <div className="h-[13px] w-28 bg-muted animate-pulse rounded shrink-0"/>
          </div>
        </div>
      </header>
    );
  }

    // If no user, render simplified topbar
  if (!user) {
    return (
        <header
            className={cn("sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-md", className)}>
            <div className="mx-auto flex h-12 w-full max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-foreground">{t('navigation', 'topbarBrand')}</span>
          </div>
          <FeedbackButton />
        </div>
      </header>
    );
  }

  return (
      <header
          className={cn("z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-md sticky top-0", className)}>
          <div className="grid grid-cols-[1fr_auto_1fr] h-12 w-full items-center px-4 sm:px-6 shrink-0">
              {/* Left Section - Toggle + title (min-w-0 so title can truncate) */}
              <div className="flex items-center gap-2 min-w-0">
                  {/* Hamburger Menu - Mobile/Tablet only */}
                  {sidebarContext && isProjectPage && (
                      <Button
                          variant="ghost"
                          size="icon"
                          onClick={sidebarContext.toggleMobile}
                          aria-label={t('navigation', 'ariaOpenMenu')}
                          className="flex lg:hidden shrink-0 h-8 w-8 hover:bg-muted/50 transition-colors duration-75"
                      >
                          <Menu className="h-4 w-4 text-muted-foreground"/>
                      </Button>
                  )}
                  {/* Sidebar Toggle - Desktop only. Two icons crossfade purely on opacity. */}
          {sidebarContext && isProjectPage && (
            <Button
              variant="ghost"
              size="icon"
              onClick={sidebarContext.toggleSidebar}
              aria-label={t('layout', 'sidebarToggleAriaLabel')}
              aria-pressed={!sidebarContext.sidebarCollapsed}
              aria-keyshortcuts="Meta+B"
              className="hidden lg:flex shrink-0 h-8 w-8 hover:bg-muted/50 transition-colors duration-75 relative"
            >
              <span className="relative h-4 w-4 block">
                <PanelLeftClose
                  className={cn(
                    'absolute inset-0 h-4 w-4 text-muted-foreground transition-opacity duration-150 ease-out motion-reduce:duration-0',
                    sidebarContext.sidebarCollapsed ? 'opacity-0' : 'opacity-100',
                  )}
                />
                <PanelLeftOpen
                  className={cn(
                    'absolute inset-0 h-4 w-4 text-muted-foreground transition-opacity duration-150 ease-out motion-reduce:duration-0',
                    sidebarContext.sidebarCollapsed ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </span>
            </Button>
          )}

                  {/* Breadcrumb or Brand */}
                  {!isProjectPage ? (
                      <div className="flex items-center gap-2 px-2">
                          <div className="h-5 w-5 rounded bg-primary flex items-center justify-center">
                              <span className="text-[10px] font-bold text-primary-foreground">R</span>
                          </div>
                          <span
                              className="text-[13px] font-medium text-foreground tracking-tight">{t('navigation', 'topbarBrandFull')}</span>
                      </div>
                  ) : (
                      <span className="flex items-center gap-1.5 min-w-0 px-2">
                        <span className="text-[13px] font-medium text-foreground truncate">
                          {tabIdToLabel[projectContext?.activeTab ?? ''] ?? t('layout', 'defaultProjectName')}
                        </span>
                        {sectionDescriptionKey[projectContext?.activeTab ?? ''] && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button type="button" className="text-muted-foreground/60 hover:text-foreground transition-colors" aria-label={t('navigation', sectionDescriptionKey[projectContext?.activeTab ?? ''])}>
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

        {/* Center Section - View Switcher */}
        <div className="flex items-center justify-center">
          {isProjectPage && <SectionViewSwitcher />}
        </div>

        {/* Right Section - Notifications + Feedback */}
        <div className="flex items-center justify-end gap-1.5 shrink-0">
          <NotificationCenter />
          <FeedbackButton />
        </div>
      </div>
    </header>
  );
};

export default Topbar;
