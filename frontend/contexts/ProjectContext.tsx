/**
 * Contexto para gerenciar estado do projeto e navegação
 * Single Source of Truth para activeTab
 */

import React, {createContext, ReactNode, useCallback, useContext, useEffect, useState} from 'react';
import {useSearchParams} from 'react-router-dom';

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

export const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

interface ProjectProviderProps {
  children: ReactNode;
}

export const ProjectProvider: React.FC<ProjectProviderProps> = ({ children }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  
  // Ler tab da URL ou usar padrão
  const tabFromUrl = searchParams.get('tab');
  const initialTab = (tabFromUrl && ['articles', 'extraction', 'assessment', 'settings'].includes(tabFromUrl)) 
    ? tabFromUrl 
    : 'articles';
  
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  // Sincronizar activeTab quando URL mudar (vindo de outras páginas)
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl && ['articles', 'extraction', 'assessment', 'settings'].includes(tabFromUrl)) {
      // Atualizar apenas se for diferente para evitar loops
      setActiveTab(prevTab => {
        return prevTab !== tabFromUrl ? tabFromUrl : prevTab;
      });
    }
  }, [searchParams]); // Só observar mudanças na URL, não criar loop com activeTab

  // Sincronizar URL quando activeTab mudar (navegação interna)
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', activeTab);
    setSearchParams(newParams, { replace: true });
  }, [activeTab, searchParams, setSearchParams]);

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
