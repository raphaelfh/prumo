/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Componente principal do Topbar
 * Integra todos os elementos de navegação superior
 */

import React, { useState } from 'react';
import { Menu, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useUserProfile } from '@/hooks/useNavigation';
import { useSidebar } from '@/contexts/SidebarContext';
import { useProject } from '@/contexts/ProjectContext';
import { ProfileMenu } from './ProfileMenu';
import { MobileSidebar } from '@/components/layout/MobileSidebar';
import { FeedbackButton } from '@/components/feedback/FeedbackButton';
import { NotificationCenter } from './NotificationCenter';
import type { TopbarProps } from '@/types/navigation';

export const Topbar: React.FC<TopbarProps> = ({
  className,
}) => {
  const { user, isLoading } = useUserProfile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // Usar contexto do sidebar apenas em páginas de projeto
  const isProjectPage = window.location.pathname.includes('/projects/');
  
  let sidebarContext;
  let projectContext;
  try {
    sidebarContext = useSidebar();
    projectContext = useProject();
  } catch {
    // Se não estiver no contexto, não usar
    sidebarContext = null;
    projectContext = null;
  }

  // Renderizar estado de loading de forma mais robusta
  if (isLoading) {
    return (
      <header className={cn("sticky top-0 z-40 w-full border-b bg-background", className)}>
        <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center gap-3 px-4">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 bg-muted animate-pulse rounded" />
            <div className="h-4 w-24 bg-muted animate-pulse rounded" />
          </div>
        </div>
      </header>
    );
  }

  // Se não há usuário, renderizar topbar simplificado
  if (!user) {
    return (
      <header className={cn("sticky top-0 z-40 w-full border-b bg-background", className)}>
        <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Review Hub</span>
          </div>
          <FeedbackButton />
        </div>
      </header>
    );
  }

  return (
    <header className={cn("z-40 w-full border-b bg-background", className)}>
      <div className="flex h-14 w-full items-center justify-between px-6 flex-shrink-0">
        {/* Left Section - Toggle */}
        <div className="flex items-center gap-3">
          {/* Sidebar Toggle - Apenas Desktop */}
          {sidebarContext && isProjectPage && (
            <Button
              variant="ghost"
              size="icon"
              onClick={sidebarContext.toggleSidebar}
              aria-label={sidebarContext.sidebarCollapsed ? "Expandir sidebar" : "Recolher sidebar"}
              className="hidden lg:flex flex-shrink-0"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          )}

          {/* Mobile Menu Button - para páginas de projeto */}
          {isProjectPage && projectContext && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden flex-shrink-0"
                aria-label="Abrir menu"
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu className="h-4 w-4" />
              </Button>
              
              <MobileSidebar
                open={mobileMenuOpen}
                onOpenChange={setMobileMenuOpen}
                activeTab={projectContext.activeTab}
                onTabChange={projectContext.changeTab}
                projectName={projectContext.project?.name}
              />
            </>
          )}
        </div>

        {/* Right Section - Notifications + Feedback + Profile Menu */}
        <div className="flex items-center gap-1">
          <NotificationCenter />
          <FeedbackButton />
          <ProfileMenu user={user} />
        </div>
      </div>
    </header>
  );
};

// Componente de Topbar simplificado para telas específicas
export const SimpleTopbar: React.FC<{
  title: string;
  onBack?: () => void;
  className?: string;
}> = ({ title, onBack, className }) => {
  const { user } = useUserProfile();

  return (
    <header className={cn("sticky top-0 z-40 w-full border-b bg-background", className)}>
      <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center gap-3 px-4">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Voltar">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Button>
        )}
        
        <div className="flex-1">
          <h1 className="text-lg font-semibold truncate">{title}</h1>
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
