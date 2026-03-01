/**
 * Hook para gerenciar estado de navegação
 * Centraliza lógica de breadcrumbs, busca e navegação
 */

import {useCallback, useEffect, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/contexts/AuthContext';
import {BarChart3, File, FileText, Folder, LogIn, Settings} from 'lucide-react';
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

      // Sempre começar com Home
      items.push({
        label: 'Dashboard',
        href: '/',
      });

      let currentPath = '';
        pathSegments.forEach((segment, index) => {
          currentPath += `/${segment}`;
          const isLast = index === pathSegments.length - 1;
          
          // Mapear segmentos para labels amigáveis
          let label = segment;
          let icon;
          let shouldSkip = false;
          
          switch (segment) {
            case 'projects':
              // Não adicionar "Projetos" nos breadcrumbs, pular para o próximo
              shouldSkip = true;
              break;
            case 'assessment':
              label = 'Avaliação';
              icon = BarChart3;
              break;
            case 'articles':
              label = 'Artigos';
              icon = FileText;
              break;
            case 'settings':
              label = 'Configurações';
              icon = Settings;
              break;
            case 'auth':
              label = 'Autenticação';
              icon = LogIn;
              break;
            default:
              // Se for um ID, tentar buscar o nome do recurso
              if (segment.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
                // Buscar nome do recurso baseado no contexto
                const previousSegment = pathSegments[index - 1];
                if (previousSegment === 'projects') {
                  label = 'Projeto';
                  icon = Folder;
                } else if (previousSegment === 'articles') {
                  label = 'Artigo';
                  icon = FileText;
                } else {
                  label = 'Detalhes';
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
      console.error('Erro ao gerar breadcrumbs:', error);
      return [{ label: 'Dashboard', href: '/', isActive: true }];
    }
  }, [location.pathname]);

  // Atualizar breadcrumbs quando a rota mudar
  useEffect(() => {
    setBreadcrumbs(generateBreadcrumbs());
  }, [generateBreadcrumbs]);

  // Busca global
  const performSearch = useCallback(async (query: string): Promise<SearchResult[]> => {
    if (!query.trim()) return [];

    setIsSearching(true);
    try {
      const results: SearchResult[] = [];

      // Buscar projetos
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

      // Buscar artigos
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
      console.error('Erro na busca:', error);
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

  // Carregar notificações do usuário
  const loadNotifications = useCallback(async () => {
    try {
      // Por enquanto, simular notificações
      // Em produção, buscar do banco de dados
      const mockNotifications: NotificationItem[] = [
        {
          id: '1',
          title: 'Nova avaliação disponível',
          message: 'Você tem uma nova avaliação pendente no projeto "Revisão Sistemática"',
          type: 'info',
          timestamp: new Date(),
          isRead: false,
          actionUrl: '/projects/123/assessment',
        },
        {
          id: '2',
          title: 'Projeto finalizado',
          message: 'O projeto "Análise de Qualidade" foi concluído com sucesso',
          type: 'success',
          timestamp: new Date(Date.now() - 3600000),
          isRead: true,
        },
      ];

      setNotifications(mockNotifications);
      setUnreadCount(mockNotifications.filter(n => !n.isRead).length);
    } catch (error) {
      console.error('Erro ao carregar notificações:', error);
    }
  }, []);

  // Marcar notificação como lida
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
        console.warn('Erro ao buscar perfil, usando dados básicos:', profileError);
        setUser({
          id: authUser.id,
          name: authUser.user_metadata?.full_name || 'Usuário',
          email: authUser.email || '',
            initials: authUser.email?.charAt(0).toUpperCase() || 'U',
          role: 'Pesquisador',
        });
        return;
      }

      if (profile) {
        const initials = profile.full_name
            ? profile.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase()
          : authUser.email?.charAt(0).toUpperCase() || 'U';

        setUser({
          id: authUser.id,
          name: profile.full_name || 'Usuário',
          email: authUser.email || '',
          avatar: profile.avatar_url || undefined,
          initials,
          role: 'Pesquisador',
          organization: 'Instituto de Pesquisa',
        });
      }
      } catch (err) {
          console.error('Erro inesperado ao carregar perfil:', err);
      setError('Erro ao carregar perfil do usuário');
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
