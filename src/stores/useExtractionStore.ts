/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Zustand Store para Estado de Extração
 * 
 * Centraliza estado de extração para:
 * - Evitar prop drilling excessivo
 * - Facilitar acesso global ao contexto de extração
 * - Manter sincronização entre componentes
 * 
 * NOTA: Store é OPCIONAL. Componentes podem continuar usando props
 * diretamente. Use o store apenas quando prop drilling for problemático.
 * 
 * @module stores/useExtractionStore
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { 
  ProjectExtractionTemplate,
  ExtractionEntityType,
  ExtractionInstance,
  ExtractionField
} from '@/types/extraction';

// =================== INTERFACES ===================

interface ExtractionState {
  // Contexto atual
  projectId: string | null;
  articleId: string | null;
  template: ProjectExtractionTemplate | null;
  
  // Dados carregados
  entityTypes: ExtractionEntityType[];
  instances: ExtractionInstance[];
  fields: Map<string, ExtractionField[]>; // entityTypeId -> fields
  
  // UI State
  showPDF: boolean;
  viewMode: 'extract' | 'compare';
  activeModelId: string | null;
  
  // Loading states
  isLoading: boolean;
  isInitialized: boolean;
}

interface ExtractionActions {
  // Inicialização
  initialize: (projectId: string, articleId: string, template: ProjectExtractionTemplate) => void;
  reset: () => void;
  
  // Setters
  setEntityTypes: (entityTypes: ExtractionEntityType[]) => void;
  setInstances: (instances: ExtractionInstance[]) => void;
  setFields: (entityTypeId: string, fields: ExtractionField[]) => void;
  
  // Instance management
  addInstance: (instance: ExtractionInstance) => void;
  removeInstance: (instanceId: string) => void;
  updateInstance: (instanceId: string, updates: Partial<ExtractionInstance>) => void;
  
  // UI actions
  togglePDF: () => void;
  setViewMode: (mode: 'extract' | 'compare') => void;
  setActiveModelId: (modelId: string | null) => void;
  setLoading: (loading: boolean) => void;
  
  // Selectors (computed values)
  getInstancesByEntityType: (entityTypeId: string) => ExtractionInstance[];
  getInstancesByParent: (parentInstanceId: string) => ExtractionInstance[];
  getFieldsByEntityType: (entityTypeId: string) => ExtractionField[];
}

export type ExtractionStore = ExtractionState & ExtractionActions;

// =================== INITIAL STATE ===================

const initialState: ExtractionState = {
  projectId: null,
  articleId: null,
  template: null,
  entityTypes: [],
  instances: [],
  fields: new Map(),
  showPDF: true,
  viewMode: 'extract',
  activeModelId: null,
  isLoading: false,
  isInitialized: false,
};

// =================== STORE ===================

export const useExtractionStore = create<ExtractionStore>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        // =================== INICIALIZAÇÃO ===================

        initialize: (projectId, articleId, template) => {
          set({
            projectId,
            articleId,
            template,
            isInitialized: true,
          }, false, 'extraction/initialize');
        },

        reset: () => {
          set(initialState, false, 'extraction/reset');
        },

        // =================== SETTERS ===================

        setEntityTypes: (entityTypes) => {
          set({ entityTypes }, false, 'extraction/setEntityTypes');
        },

        setInstances: (instances) => {
          set({ instances }, false, 'extraction/setInstances');
        },

        setFields: (entityTypeId, fields) => {
          set((state) => {
            const newFieldsMap = new Map(state.fields);
            newFieldsMap.set(entityTypeId, fields);
            return { fields: newFieldsMap };
          }, false, 'extraction/setFields');
        },

        // =================== INSTANCE MANAGEMENT ===================

        addInstance: (instance) => {
          set((state) => ({
            instances: [...state.instances, instance]
          }), false, 'extraction/addInstance');
        },

        removeInstance: (instanceId) => {
          set((state) => ({
            instances: state.instances.filter(i => i.id !== instanceId)
          }), false, 'extraction/removeInstance');
        },

        updateInstance: (instanceId, updates) => {
          set((state) => ({
            instances: state.instances.map(i => 
              i.id === instanceId ? { ...i, ...updates } : i
            )
          }), false, 'extraction/updateInstance');
        },

        // =================== UI ACTIONS ===================

        togglePDF: () => {
          set((state) => ({
            showPDF: !state.showPDF
          }), false, 'extraction/togglePDF');
        },

        setViewMode: (mode) => {
          set({ viewMode: mode }, false, 'extraction/setViewMode');
        },

        setActiveModelId: (modelId) => {
          set({ activeModelId: modelId }, false, 'extraction/setActiveModelId');
        },

        setLoading: (loading) => {
          set({ isLoading: loading }, false, 'extraction/setLoading');
        },

        // =================== SELECTORS ===================

        getInstancesByEntityType: (entityTypeId) => {
          return get().instances.filter(i => i.entity_type_id === entityTypeId);
        },

        getInstancesByParent: (parentInstanceId) => {
          return get().instances.filter(i => i.parent_instance_id === parentInstanceId);
        },

        getFieldsByEntityType: (entityTypeId) => {
          return get().fields.get(entityTypeId) || [];
        },
      }),
      {
        name: 'extraction-store',
        // Persistir apenas preferências de UI
        partialize: (state) => ({
          showPDF: state.showPDF,
          viewMode: state.viewMode,
        }),
      }
    )
  )
);

// =================== HOOKS AUXILIARES ===================

/**
 * Hook para acessar apenas contexto (sem causar re-render desnecessário)
 */
export const useExtractionContext = () => {
  const projectId = useExtractionStore(state => state.projectId);
  const articleId = useExtractionStore(state => state.articleId);
  const template = useExtractionStore(state => state.template);
  
  return { projectId, articleId, template };
};

/**
 * Hook para UI state (PDF, viewMode, etc)
 */
export const useExtractionUI = () => {
  const showPDF = useExtractionStore(state => state.showPDF);
  const viewMode = useExtractionStore(state => state.viewMode);
  const activeModelId = useExtractionStore(state => state.activeModelId);
  const togglePDF = useExtractionStore(state => state.togglePDF);
  const setViewMode = useExtractionStore(state => state.setViewMode);
  const setActiveModelId = useExtractionStore(state => state.setActiveModelId);
  
  return {
    showPDF,
    viewMode,
    activeModelId,
    togglePDF,
    setViewMode,
    setActiveModelId,
  };
};

/**
 * Hook para instances com selectors
 */
export const useExtractionInstances = () => {
  const instances = useExtractionStore(state => state.instances);
  const setInstances = useExtractionStore(state => state.setInstances);
  const addInstance = useExtractionStore(state => state.addInstance);
  const removeInstance = useExtractionStore(state => state.removeInstance);
  const updateInstance = useExtractionStore(state => state.updateInstance);
  const getInstancesByEntityType = useExtractionStore(state => state.getInstancesByEntityType);
  const getInstancesByParent = useExtractionStore(state => state.getInstancesByParent);
  
  return {
    instances,
    setInstances,
    addInstance,
    removeInstance,
    updateInstance,
    getInstancesByEntityType,
    getInstancesByParent,
  };
};

// =================== DEBUG ===================

if (import.meta.env.DEV) {
  (window as any).extractionStore = useExtractionStore;
  console.log('🏪 Extraction store available: window.extractionStore.getState()');
}

