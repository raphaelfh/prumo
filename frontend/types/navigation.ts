import type {LucideIcon} from 'lucide-react';

/**
 * Item de breadcrumb na navegação superior
 */
export interface BreadcrumbItem {
  label: string;
  href?: string;
  isActive?: boolean;
  icon?: LucideIcon;
}

/**
 * Resultado de busca global
 */
export interface SearchResult {
  id: string;
  title: string;
  description?: string;
  type: 'project' | 'article' | 'assessment';
  href: string;
  icon: LucideIcon;
  metadata?: Record<string, any>;
}

/**
 * Notificação do sistema
 */
export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: Date;
  isRead: boolean;
  actionUrl?: string;
}

/**
 * Perfil do usuário
 */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  initials: string;
  role?: string;
  organization?: string;
}

/**
 * Propriedades do componente Topbar
 */
export interface TopbarProps {
  config?: {
    showSearch?: boolean;
    showNotifications?: boolean;
    showHelp?: boolean;
    showThemeToggle?: boolean;
  };
  className?: string;
}

/**
 * Configuração de navegação de projeto
 */
export interface ProjectNavigationConfig {
  activeTab: string;
  tabs: NavigationTab[];
}

/**
 * Tab de navegação
 */
export interface NavigationTab {
  id: string;
  label: string;
  icon: LucideIcon;
  description?: string;
  badge?: string | number;
}
