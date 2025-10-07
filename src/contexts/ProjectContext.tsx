/**
 * Contexto para gerenciar estado do projeto e navegação
 * Single Source of Truth para activeTab
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  review_title: string | null;
  condition_studied: string | null;
}

export interface ProjectContextType {
  project: Project | null;
  setProject: (project: Project | null) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  changeTab: (tab: string) => void;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

interface ProjectProviderProps {
  children: ReactNode;
}

export const ProjectProvider: React.FC<ProjectProviderProps> = ({ children }) => {
  const [project, setProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<string>('articles');

  // Função centralizada para mudança de tabs
  // Preparada para adicionar analytics, validações, etc.
  const changeTab = useCallback((tab: string) => {
    setActiveTab(tab);
    
    // Analytics (futuro)
    // trackEvent('tab_change', { tab, projectId: project?.id });
    
    // Validações (futuro)
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
    throw new Error('useProject deve ser usado dentro de um ProjectProvider');
  }
  return context;
};
