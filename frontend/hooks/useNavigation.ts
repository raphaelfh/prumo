/**
 * Hook to manage navigation state
 * Centralizes breadcrumbs, search and navigation logic
 */

import {useCallback, useEffect, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/contexts/AuthContext';
import {t} from '@/lib/copy';
import {File, FileText, Folder, LogIn, Settings} from 'lucide-react';
import type {BreadcrumbItem, NotificationItem, SearchResult, UserProfile} from '@/types/navigation';

export const useNavigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
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

    // Update breadcrumbs when route changes
  useEffect(() => {
    setBreadcrumbs(generateBreadcrumbs());
  }, [generateBreadcrumbs]);

  // Busca global
  const performSearch = useCallback(async (query: string): Promise<SearchResult[]> => {
    if (!query.trim()) return [];

    setIsSearching(true);
    try {
      const results: SearchResult[] = [];

        // Fetch projects
      const { data: projects } = await supabase
        .from('projects')
        .select('id, name, description')
        .ilike('name', `%${query}%`)
        .limit(5);

      projects?.forEach(project => {
        results.push({
          id: project.id,
          title: project.name,
          description: project.description || undefined,
          type: 'project',
          href: `/projects/${project.id}`,
          icon: Folder,
          metadata: { projectId: project.id },
        });
      });

        // Fetch articles
      const { data: articles } = await supabase
        .from('articles')
        .select('id, title, abstract')
        .ilike('title', `%${query}%`)
        .limit(5);

      articles?.forEach(article => {
        results.push({
          id: article.id,
          title: article.title,
          description: article.abstract || undefined,
          type: 'article',
          href: `/articles/${article.id}`,
          icon: FileText,
          metadata: { articleId: article.id },
        });
      });

      return results;
    } catch (error) {
        console.error('Search error:', error);
      return [];
    } finally {
      setIsSearching(false);
    }
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
  const loadNotifications = useCallback(async () => {
    try {
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
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
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
    loadNotifications();
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

      try {
          setError(null);
          setIsLoading(true);

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (profileError) {
          console.warn('Error fetching profile, using basic data:', profileError);
        setUser({
          id: authUser.id,
            name: authUser.user_metadata?.full_name || 'User',
          email: authUser.email || '',
            initials: authUser.email?.charAt(0).toUpperCase() || 'U',
            role: 'Researcher',
        });
        return;
      }

      if (profile) {
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
      } catch (err) {
          console.error('Unexpected error loading profile:', err);
          setError(t('common', 'errors_loadProfileFailed'));
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [authUser]);

  useEffect(() => {
    loadUserProfile();
  }, [loadUserProfile]);

  return {
    user,
    isLoading,
    error,
    refreshProfile: loadUserProfile,
  };
};
