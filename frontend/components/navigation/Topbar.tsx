/**
 * Main Topbar component
 * Integrates all top navigation elements
 */

import React, {useContext, useState} from 'react';
import {Menu, PanelLeftClose, PanelLeftOpen} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {useUserProfile} from '@/hooks/useNavigation';
import {SidebarContext} from '@/contexts/SidebarContext';
import {ProjectContext} from '@/contexts/ProjectContext';
import {ProfileMenu} from './ProfileMenu';
import {FeedbackButton} from '@/components/feedback/FeedbackButton';
import {NotificationCenter} from './NotificationCenter';
import type {TopbarProps} from '@/types/navigation';
import {tabIdToLabel} from '@/components/layout/sidebarConfig';
import {t} from '@/lib/copy';

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
              <div className="h-5 w-5 rounded bg-muted animate-pulse flex-shrink-0"/>
              <div className="h-[13px] w-28 bg-muted animate-pulse rounded flex-shrink-0"/>
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
          <div className="flex h-12 w-full items-center justify-between px-4 sm:px-6 flex-shrink-0">
              {/* Left Section - Toggle + title (min-w-0 so title can truncate) */}
              <div className="flex items-center gap-2 min-w-0 flex-1">
                  {/* Hamburger Menu - Mobile/Tablet only */}
                  {sidebarContext && isProjectPage && (
                      <Button
                          variant="ghost"
                          size="icon"
                          onClick={sidebarContext.toggleMobile}
                          aria-label={t('navigation', 'ariaOpenMenu')}
                          className="flex lg:hidden flex-shrink-0 h-8 w-8 hover:bg-muted/50 transition-colors duration-75"
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
              className="hidden lg:flex flex-shrink-0 h-8 w-8 hover:bg-muted/50 transition-colors duration-75 relative"
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
                      <span className="text-[13px] font-medium text-foreground px-2 truncate block min-w-0">
                        {tabIdToLabel[projectContext?.activeTab ?? ''] ?? t('layout', 'defaultProjectName')}
                      </span>
                  )}

        </div>

        {/* Right Section - Notifications + Feedback + Profile Menu */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
          <NotificationCenter />
          <FeedbackButton />
                  <div className="h-4 w-[1px] bg-border/40 mx-1"/>
          <ProfileMenu user={user} />
        </div>
      </div>
    </header>
  );
};

// Simplified Topbar component for specific screens
export const SimpleTopbar: React.FC<{
  title: string;
  onBack?: () => void;
  className?: string;
}> = ({ title, onBack, className }) => {
  const { user } = useUserProfile();

  return (
      <header
          className={cn("sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-md", className)}>
          <div className="mx-auto flex h-12 w-full max-w-[1200px] items-center gap-3 px-4">
        {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack} aria-label={t('navigation', 'ariaBack')}>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Button>
        )}
        
        <div className="flex-1">
            <h1 className="text-[13px] font-medium truncate">{title}</h1>
        </div>

        {user && (
          <div className="flex items-center gap-1">
            <FeedbackButton />
            <ProfileMenu user={user} />
          </div>
        )}
      </div>
    </header>
  );
};

export default Topbar;
