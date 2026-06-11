import {useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';

export type ProjectTab = 'articles' | 'extraction' | 'settings';

interface UseProjectNavigationReturn {
  activeTab: ProjectTab;
  changeTab: (tab: ProjectTab) => void;
  navigateToArticle: (articleId: string) => void;
}

export function useProjectNavigation(): UseProjectNavigationReturn {
  const [activeTab, setActiveTab] = useState<ProjectTab>('articles');
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();

  const changeTab = (tab: ProjectTab) => {
    setActiveTab(tab);
  };

  const navigateToArticle = (articleId: string) => {
    if (!projectId) return;
    navigate(`/projects/${projectId}/articles/${articleId}`);
  };

  return {
    activeTab,
    changeTab,
    navigateToArticle,
  };
}
