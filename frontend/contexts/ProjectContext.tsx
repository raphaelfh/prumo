/**
 * Context for project state and navigation
 * Single source of truth for activeTab
 */

import React, {createContext, ReactNode, useCallback, useContext, useEffect, useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {t} from '@/lib/copy';
import type {ProjectSummary} from '@/types/project';

export interface ProjectContextType {
    project: ProjectSummary | null;
    setProject: (project: ProjectSummary | null) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  changeTab: (tab: string) => void;
}

export const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

const VALID_TABS = ['articles', 'extraction', 'settings', 'overview', 'screening', 'prisma', 'quality'];

interface ProjectProviderProps {
  children: ReactNode;
}

export const ProjectProvider: React.FC<ProjectProviderProps> = ({ children }) => {
  const [searchParams, setSearchParams] = useSearchParams();
    const [project, setProject] = useState<ProjectSummary | null>(null);

    // Read tab from URL or use default
  const tabFromUrl = searchParams.get('tab');
  const initialTab = (tabFromUrl && VALID_TABS.includes(tabFromUrl))
    ? tabFromUrl
    : 'articles';

  const [activeTab, setActiveTab] = useState<string>(initialTab);

    // Sync activeTab when URL changes (coming from other pages) — adjusted
    // during render instead of via effect to avoid a cascading render.
  const [prevSearchParams, setPrevSearchParams] = useState(searchParams);
  if (searchParams !== prevSearchParams) {
    setPrevSearchParams(searchParams);
    const urlTab = searchParams.get('tab');
    if (urlTab && VALID_TABS.includes(urlTab) && urlTab !== activeTab) {
      setActiveTab(urlTab);
    }
  }

    // Sync URL when activeTab changes (internal navigation)
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', activeTab);
    setSearchParams(newParams, { replace: true });
  }, [activeTab, searchParams, setSearchParams]);

    // Centralized tab change handler
    // Ready for analytics, validations, etc.
  const changeTab = useCallback((tab: string) => {
    setActiveTab(tab);

      // Analytics (future)
    // trackEvent('tab_change', { tab, projectId: project?.id });

      // Validations (future)
    // if (hasUnsavedChanges) showConfirmDialog();
  }, []);

  return (
    <ProjectContext.Provider
      value={{
        project,
        setProject,
        activeTab,
        setActiveTab,
        changeTab,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
};

export const useProject = () => {
  const context = useContext(ProjectContext);
  if (context === undefined) {
      throw new Error(t('common', 'errors_useProject'));
  }
  return context;
};
