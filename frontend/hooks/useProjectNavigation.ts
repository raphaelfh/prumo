import {useCallback, useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';

export type ProjectTab = 'articles' | 'extraction' | 'assessment' | 'settings';

interface UseProjectNavigationReturn {
  activeTab: ProjectTab;
  changeTab: (tab: ProjectTab) => void;
  navigateToArticle: (articleId: string) => void;
  navigateToAssessment: (articleId: string, instrumentId: string) => void;
}

export function useProjectNavigation(): UseProjectNavigationReturn {
  const [activeTab, setActiveTab] = useState<ProjectTab>('articles');
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();

  const changeTab = useCallback((tab: ProjectTab) => {
    setActiveTab(tab);
  }, []);

  const navigateToArticle = useCallback((articleId: string) => {
    if (!projectId) return;
    navigate(`/projects/${projectId}/articles/${articleId}`);
  }, [projectId, navigate]);

  const navigateToAssessment = useCallback((articleId: string, instrumentId: string) => {
    if (!projectId) return;
    navigate(`/projects/${projectId}/assessment/${articleId}/${instrumentId}`);
  }, [projectId, navigate]);

  return {
    activeTab,
    changeTab,
    navigateToArticle,
    navigateToAssessment,
  };
}
