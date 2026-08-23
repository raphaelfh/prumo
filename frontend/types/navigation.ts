



/**
 * User profile
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


