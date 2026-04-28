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

interface ProjectProviderProps {
  children: ReactNode;
}

export const ProjectProvider: React.FC<ProjectProviderProps> = ({ children }) => {
  const [searchParams, setSearchParams] = useSearchParams();
    const [project, setProject] = useState<ProjectSummary | null>(null);

    // Read tab from URL or use default
  const tabFromUrl = searchParams.get('tab');
  const initialTab = (tabFromUrl && ['articles', 'extraction', 'settings', 'overview', 'members', 'screening', 'prisma'].includes(tabFromUrl))
    ? tabFromUrl 
    : 'articles';
  
  const [activeTab, setActiveTab] = useState<string>(initialTab);

    // Sync activeTab when URL changes (coming from other pages)
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl && ['articles', 'extraction', 'settings', 'overview', 'members', 'screening', 'prisma'].includes(tabFromUrl)) {
        // Update only if different to avoid loops
      setActiveTab(prevTab => {
        return prevTab !== tabFromUrl ? tabFromUrl : prevTab;
      });
    }
  }, [searchParams]); // Only watch URL changes, do not create loop with activeTab

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
