/**
 * Hook to manage navigation state
 * Centralizes breadcrumbs, search and navigation logic
 */

import {useCallback, useEffect, useMemo, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {useAuth} from '@/contexts/AuthContext';
import {t} from '@/lib/copy';
import {File, FileText, Folder, LogIn, Settings} from 'lucide-react';
import type {BreadcrumbItem, NotificationItem, SearchResult, UserProfile} from '@/types/navigation';
import {searchProjects, searchArticles, loadUserProfile as loadUserProfileSvc} from '@/services/projectSettingsService';

export const useNavigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Gerar breadcrumbs baseado na rota atual
  const generateBreadcrumbs = useCallback((): BreadcrumbItem[] => {
    try {
      const pathSegments = location.pathname.split('/').filter(Boolean);
      const items: BreadcrumbItem[] = [];

        // Always start with Home
      items.push({
        label: 'Dashboard',
        href: '/',
      });

      let currentPath = '';
        pathSegments.forEach((segment, index) => {
          currentPath += `/${segment}`;
          const isLast = index === pathSegments.length - 1;

            // Map segments to friendly labels
          let label = segment;
          let icon;
          let shouldSkip = false;
          
          switch (segment) {
            case 'projects':
                // Do not add "Projects" to breadcrumbs, skip to next
              shouldSkip = true;
              break;
            case 'articles':
                label = 'Articles';
              icon = FileText;
              break;
            case 'settings':
                label = 'Settings';
              icon = Settings;
              break;
            case 'auth':
                label = 'Authentication';
              icon = LogIn;
              break;
            default:
              // Se for um ID, tentar buscar o nome do recurso
              if (segment.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
                  // Fetch resource name based on context
                const previousSegment = pathSegments[index - 1];
                if (previousSegment === 'projects') {
                    label = 'Project';
                  icon = Folder;
                } else if (previousSegment === 'articles') {
                    label = 'Article';
                  icon = FileText;
                } else {
                    label = 'Details';
                  icon = File;
                }
              }
              break;
          }

          if (!shouldSkip) {
            items.push({
              label,
              href: isLast ? undefined : currentPath,
              isActive: isLast,
              icon,
            });
          }
        });

      return items;
    } catch (error) {
        console.error('Error generating breadcrumbs:', error);
      return [{ label: 'Dashboard', href: '/', isActive: true }];
    }
  }, [location.pathname]);

    // Breadcrumbs are a pure function of the route — derive instead of
    // materializing through an effect.
  const breadcrumbs = useMemo(() => generateBreadcrumbs(), [generateBreadcrumbs]);

  // Busca global
  const performSearch = useCallback(async (query: string): Promise<SearchResult[]> => {
    if (!query.trim()) return [];

    setIsSearching(true);
    const [projectsResult, articlesResult] = await Promise.all([
      searchProjects(query),
      searchArticles(query),
    ]);
    setIsSearching(false);

    const results: SearchResult[] = [];

    if (projectsResult.ok) {
      projectsResult.data.forEach(project => {
        results.push({
          id: project.id,
          title: project.name,
          description: project.description || undefined,
          type: 'project',
          href: `/projects/${project.id}`,
          icon: Folder,
          metadata: {projectId: project.id},
        });
      });
    }

    if (articlesResult.ok) {
      articlesResult.data.forEach(article => {
        results.push({
          id: article.id,
          title: article.title,
          description: article.abstract || undefined,
          type: 'article',
          href: `/articles/${article.id}`,
          icon: FileText,
          metadata: {articleId: article.id},
        });
      });
    }

    return results;
  }, []);

  // Navegar para resultado da busca
  const navigateToSearchResult = useCallback((result: SearchResult) => {
    navigate(result.href);
    setIsSearchOpen(false);
  }, [navigate]);

  return {
    breadcrumbs,
    isSearchOpen,
    setIsSearchOpen,
    searchResults,
    isSearching,
    performSearch,
    navigateToSearchResult,
  };
};

export const useNotifications = () => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

    // Load user notifications
  const loadNotifications = useCallback(() => {
    // For now, simulate notifications
    // In production, fetch from database
    const mockNotifications: NotificationItem[] = [
      {
        id: '2',
        title: t('navigation', 'notifProjectCompletedTitle'),
        message: t('navigation', 'notifProjectCompletedMessage'),
        type: 'success',
        timestamp: new Date(Date.now() - 3600000),
        isRead: true,
      },
    ];
    setNotifications(mockNotifications);
    setUnreadCount(mockNotifications.filter(n => !n.isRead).length);
  }, []);

    // Mark notification as read
  const markAsRead = useCallback((notificationId: string) => {
    setNotifications(prev => 
      prev.map(n => 
        n.id === notificationId ? { ...n, isRead: true } : n
      )
    );
    setUnreadCount(prev => Math.max(0, prev - 1));
  }, []);

  // Marcar todas como lidas
  const markAllAsRead = useCallback(() => {
    setNotifications(prev => 
      prev.map(n => ({ ...n, isRead: true }))
    );
    setUnreadCount(0);
  }, []);

  useEffect(() => {
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void loadNotifications());
  }, [loadNotifications]);

  return {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    refreshNotifications: loadNotifications,
  };
};

export const useUserProfile = () => {
    const {user: authUser} = useAuth();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadUserProfile = useCallback(async () => {
    if (!authUser) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    setError(null);
    setIsLoading(true);
    const result = await loadUserProfileSvc(authUser.id);
    if (!result.ok) {
      console.error('Unexpected error loading profile:', result.error);
      setError(t('common', 'errors_loadProfileFailed'));
      setUser(null);
      setIsLoading(false);
      return;
    }
    const profile = result.data;
    if (!profile) {
      // Not found — fall back to auth metadata
      console.warn('Profile not found, using basic data');
      setUser({
        id: authUser.id,
        name: authUser.user_metadata?.full_name || 'User',
        email: authUser.email || '',
        initials: authUser.email?.charAt(0).toUpperCase() || 'U',
        role: 'Researcher',
      });
    } else {
      const initials = profile.full_name
        ? profile.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase()
        : authUser.email?.charAt(0).toUpperCase() || 'U';
      setUser({
        id: authUser.id,
        name: profile.full_name || 'User',
        email: authUser.email || '',
        avatar: profile.avatar_url || undefined,
        initials,
        role: 'Researcher',
        organization: 'Research Institute',
      });
    }
    setIsLoading(false);
  }, [authUser]);

  useEffect(() => {
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void loadUserProfile());
  }, [loadUserProfile]);

  return {
    user,
    isLoading,
    error,
    refreshProfile: loadUserProfile,
  };
};
