import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuidv4 } from 'uuid';
import type { Annotation, AnnotationType, DrawingState } from '@/types/annotations-new';

interface PDFState {
  // PDF State
  url: string | null;
  articleId: string | null;
  numPages: number;
  currentPage: number;
  scale: number;
  rotation: number;
  
  // Annotations
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  isDrawing: boolean;
  drawingState: DrawingState | null;
  isDragging: boolean;
  dragState: { id: string; offsetX: number; offsetY: number } | null;
  isResizing: boolean;
  resizeState: { 
    id: string; 
    handle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';
    originalPos: { x: number; y: number; width: number; height: number };
    startPoint: { x: number; y: number };
  } | null;
  
  // UI State
  showAnnotations: boolean;
  annotationMode: 'select' | 'area' | 'text' | 'note';
  sidebarCollapsed: boolean;
  sidebarView: 'annotations' | 'thumbnails';
  ui: {
    viewMode: 'continuous' | 'single' | 'two-page' | 'book' | 'presentation';
    presentationMode: boolean;
    searchOpen: boolean;
  };
  
  // Annotation Style
  currentColor: string;
  currentOpacity: number;
  
  // Text Selection
  selectedText: string | null;
  textSelection: {
    text: string;
    pageNumber: number;
    rects: DOMRect[];
  } | null;
  
  // History
  history: Annotation[][];
  historyIndex: number;
  
  // Actions
  setUrl: (url: string) => void;
  setArticleId: (articleId: string) => void;
  setNumPages: (pages: number) => void;
  setCurrentPage: (page: number) => void;
  setScale: (scale: number) => void;
  setRotation: (rotation: number) => void;
  
  // Annotation Actions
  addAnnotation: (annotation: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  deleteAnnotation: (id: string) => void;
  selectAnnotation: (id: string | null) => void;
  clearAnnotations: () => void;
  setAnnotations: (annotations: Annotation[]) => void;
  
  // Drawing
  startDrawing: (x: number, y: number, page: number) => void;
  updateDrawing: (x: number, y: number) => void;
  finishDrawing: (comment?: string) => void;
  cancelDrawing: () => void;
  
  // Dragging
  startDragging: (id: string, offsetX: number, offsetY: number) => void;
  updateDragging: (x: number, y: number) => void;
  finishDragging: () => void;
  cancelDragging: () => void;
  
  // Resizing
  startResizing: (id: string, handle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w', originalPos: { x: number; y: number; width: number; height: number }, startPoint: { x: number; y: number }) => void;
  updateResizing: (x: number, y: number) => void;
  finishResizing: () => void;
  cancelResizing: () => void;
  
  // History
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  
  // Helpers
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  nextPage: () => void;
  prevPage: () => void;
  goToPage: (page: number) => void;
  toggleAnnotations: () => void;
  setAnnotationMode: (mode: 'select' | 'area' | 'text' | 'note') => void;
  toggleSidebar: () => void;
  setSidebarView: (view: 'annotations' | 'thumbnails') => void;
  setViewMode: (mode: 'continuous' | 'single' | 'two-page' | 'book' | 'presentation') => void;
  setPresentationMode: (enabled: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  
  // Color Management
  setCurrentColor: (color: string) => void;
  setCurrentOpacity: (opacity: number) => void;
  
  // Text Selection
  setTextSelection: (selection: { text: string; pageNumber: number; rects: DOMRect[] } | null) => void;
  createHighlightFromSelection: (comment?: string) => string | null;
  
  // Getters
  getAnnotationsForPage: (page: number) => Annotation[];
  getAnnotation: (id: string) => Annotation | undefined;
}

export const usePDFStore = create<PDFState>()(
  devtools(
    persist(
      immer((set, get) => ({
        // Initial State
        url: null,
        articleId: null,
        numPages: 0,
        currentPage: 1,
        scale: 1.0,
        rotation: 0,
        annotations: [],
        selectedAnnotationId: null,
        isDrawing: false,
        drawingState: null,
        isDragging: false,
        dragState: null,
        isResizing: false,
        resizeState: null,
        showAnnotations: true,
        annotationMode: 'select',
        sidebarCollapsed: false,
        sidebarView: 'annotations',
        ui: {
          viewMode: 'continuous', // Scroll contínuo como padrão
          presentationMode: false,
          searchOpen: false,
        },
        currentColor: '#FFEB3B', // Amarelo padrão
        currentOpacity: 0.4,
        selectedText: null,
        textSelection: null,
        history: [],
        historyIndex: -1,

        // Basic Setters
        setUrl: (url) => set({ url }),
        setArticleId: (articleId) => set({ articleId }),
        setNumPages: (numPages) => set({ numPages }),
        setCurrentPage: (page) => set({ currentPage: Math.max(1, Math.min(page, get().numPages)) }),
        setScale: (scale) => set({ scale: Math.max(0.5, Math.min(scale, 3.0)) }),
        setRotation: (rotation) => set({ rotation: rotation % 360 }),

        // Annotation Management
        addAnnotation: (annotation) => {
          const id = uuidv4();
          const now = new Date().toISOString();
          
          set((state) => {
            const newAnnotation: Annotation = {
              ...annotation,
              id,
              articleId: state.articleId || '',
              createdAt: now,
              updatedAt: now,
              status: 'active',
            } as Annotation;
            
            // Add to history
            const newHistory = state.history.slice(0, state.historyIndex + 1);
            newHistory.push([...state.annotations]);
            
            state.annotations.push(newAnnotation);
            state.history = newHistory;
            state.historyIndex = newHistory.length - 1;
          });
          
          return id;
        },

        updateAnnotation: (id, updates) =>
          set((state) => {
            const annotation = state.annotations.find((a) => a.id === id);
            if (annotation) {
              Object.assign(annotation, {
                ...updates,
                updatedAt: new Date().toISOString(),
              });
            }
          }),

        deleteAnnotation: (id) =>
          set((state) => {
            const newHistory = state.history.slice(0, state.historyIndex + 1);
            newHistory.push([...state.annotations]);
            
            state.annotations = state.annotations.filter((a) => a.id !== id);
            state.history = newHistory;
            state.historyIndex = newHistory.length - 1;
            
            if (state.selectedAnnotationId === id) {
              state.selectedAnnotationId = null;
            }
          }),

        selectAnnotation: (id) => set({ selectedAnnotationId: id }),

        clearAnnotations: () =>
          set({
            annotations: [],
            selectedAnnotationId: null,
            history: [],
            historyIndex: -1,
          }),

        setAnnotations: (annotations) => set({ annotations }),

        // Drawing Actions
        startDrawing: (x, y, pageNumber) => {
          console.log('📝 Store: startDrawing chamado', { x, y, pageNumber });
          set({
            isDrawing: true,
            drawingState: { startX: x, startY: y, currentX: x, currentY: y, pageNumber },
          });
        },

        updateDrawing: (x, y) =>
          set((state) => {
            if (state.drawingState) {
              state.drawingState.currentX = x;
              state.drawingState.currentY = y;
            }
          }),

        finishDrawing: (comment) => {
          console.log('✅ Store: finishDrawing chamado');
          const state = get();
          
          if (!state.drawingState) {
            console.log('⚠️ Store: Sem drawingState');
            return;
          }

          const { startX, startY, currentX, currentY } = state.drawingState;

          // Calculate relative position
          const x = Math.min(startX, currentX);
          const y = Math.min(startY, currentY);
          const width = Math.abs(currentX - startX);
          const height = Math.abs(currentY - startY);

          console.log('📏 Store: Dimensões da anotação', { x, y, width, height });

          // Only create if significant size
          if (width > 0.01 && height > 0.01) {
            const currentState = get();

            console.log('🎨 Store: Criando anotação área', { 
              color: currentState.currentColor,
              opacity: currentState.currentOpacity
            });

            const newId = get().addAnnotation({
              pageNumber: state.drawingState.pageNumber,
              type: 'area',
              position: { x, y, width, height },
              color: currentState.currentColor,
              opacity: currentState.currentOpacity,
              status: 'active',
            } as Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'>);

            console.log('✅ Store: Anotação criada com ID:', newId);
            
            // Manter modo 'area' para criar múltiplos boxes (UX melhor)
            set({ 
              selectedAnnotationId: newId, 
              selectedText: null,
              isDrawing: false,
              drawingState: null,
            });
          } else {
            console.log('⚠️ Store: Anotação muito pequena, ignorando');
            set({
              isDrawing: false,
              drawingState: null,
            });
          }
        },

        cancelDrawing: () =>
          set({
            isDrawing: false,
            drawingState: null,
          }),

        // Dragging Actions
        startDragging: (id, offsetX, offsetY) =>
          set({
            isDragging: true,
            dragState: { id, offsetX, offsetY },
            annotationMode: 'select',
          }),

        updateDragging: (x, y) => {
          const state = get();
          if (!state.isDragging || !state.dragState) return;

          const annotation = state.annotations.find(a => a.id === state.dragState!.id);
          if (!annotation) return;

          // Update annotation position (SEM atualizar timestamp para performance)
          set((draft) => {
            const ann = draft.annotations.find(a => a.id === state.dragState!.id);
            if (ann) {
              ann.position = {
                ...ann.position,
                x: x - state.dragState!.offsetX,
                y: y - state.dragState!.offsetY,
              };
              // ✅ NÃO atualizar updatedAt aqui para evitar sync excessivo
            }
          });
        },

        finishDragging: () => {
          const state = get();
          if (state.dragState) {
            console.log('✅ Finalizando drag - atualizando timestamp');
            // Atualizar timestamp APENAS ao finalizar (trigger único de sync)
            set((draft) => {
              const ann = draft.annotations.find(a => a.id === state.dragState!.id);
              if (ann) {
                ann.updatedAt = new Date().toISOString();
              }
              draft.isDragging = false;
              draft.dragState = null;
            });
          } else {
            set({
              isDragging: false,
              dragState: null,
            });
          }
        },

        cancelDragging: () =>
          set({
            isDragging: false,
            dragState: null,
          }),

        // Resizing Actions
        startResizing: (id, handle, originalPos, startPoint) => {
          console.log('🔲 Iniciando resize:', { id, handle, originalPos, startPoint });
          set({
            isResizing: true,
            resizeState: { id, handle, originalPos, startPoint },
            annotationMode: 'select',
          });
        },

        updateResizing: (x, y) => {
          const state = get();
          if (!state.isResizing || !state.resizeState) return;

          const { id, handle, originalPos, startPoint } = state.resizeState;
          const deltaX = x - startPoint.x;
          const deltaY = y - startPoint.y;

          let newPos = { ...originalPos };

          // Lógica de redimensionamento por handle
          switch (handle) {
            case 'se': // Sudeste (canto inferior direito)
              newPos.width = Math.max(0.01, originalPos.width + deltaX);
              newPos.height = Math.max(0.01, originalPos.height + deltaY);
              break;
            case 'nw': // Noroeste (canto superior esquerdo)
              newPos.x = originalPos.x + deltaX;
              newPos.y = originalPos.y + deltaY;
              newPos.width = Math.max(0.01, originalPos.width - deltaX);
              newPos.height = Math.max(0.01, originalPos.height - deltaY);
              break;
            case 'ne': // Nordeste (canto superior direito)
              newPos.y = originalPos.y + deltaY;
              newPos.width = Math.max(0.01, originalPos.width + deltaX);
              newPos.height = Math.max(0.01, originalPos.height - deltaY);
              break;
            case 'sw': // Sudoeste (canto inferior esquerdo)
              newPos.x = originalPos.x + deltaX;
              newPos.width = Math.max(0.01, originalPos.width - deltaX);
              newPos.height = Math.max(0.01, originalPos.height + deltaY);
              break;
            case 'n': // Norte (borda superior)
              newPos.y = originalPos.y + deltaY;
              newPos.height = Math.max(0.01, originalPos.height - deltaY);
              break;
            case 's': // Sul (borda inferior)
              newPos.height = Math.max(0.01, originalPos.height + deltaY);
              break;
            case 'e': // Leste (borda direita)
              newPos.width = Math.max(0.01, originalPos.width + deltaX);
              break;
            case 'w': // Oeste (borda esquerda)
              newPos.x = originalPos.x + deltaX;
              newPos.width = Math.max(0.01, originalPos.width - deltaX);
              break;
          }

          // Atualizar posição da anotação
          set((draft) => {
            const ann = draft.annotations.find(a => a.id === id);
            if (ann) {
              ann.position = newPos;
            }
          });
        },

        finishResizing: () => {
          const state = get();
          if (state.resizeState) {
            console.log('✅ Finalizando resize - atualizando timestamp');
            // Atualizar timestamp APENAS ao finalizar (trigger único de sync)
            set((draft) => {
              const ann = draft.annotations.find(a => a.id === state.resizeState!.id);
              if (ann) {
                ann.updatedAt = new Date().toISOString();
              }
              draft.isResizing = false;
              draft.resizeState = null;
            });
          } else {
            set({
              isResizing: false,
              resizeState: null,
            });
          }
        },

        cancelResizing: () =>
          set({
            isResizing: false,
            resizeState: null,
          }),

        // History
        undo: () => {
          const state = get();
          if (state.historyIndex > 0) {
            set({
              annotations: [...state.history[state.historyIndex - 1]],
              historyIndex: state.historyIndex - 1,
            });
          }
        },

        redo: () => {
          const state = get();
          if (state.historyIndex < state.history.length - 1) {
            set({
              annotations: [...state.history[state.historyIndex + 1]],
              historyIndex: state.historyIndex + 1,
            });
          }
        },

        canUndo: () => get().historyIndex > 0,
        canRedo: () => get().historyIndex < get().history.length - 1,

        // Zoom Controls
        zoomIn: () => set((state) => ({ scale: Math.min(state.scale + 0.2, 3.0) })),
        zoomOut: () => set((state) => ({ scale: Math.max(state.scale - 0.2, 0.5) })),
        resetZoom: () => set({ scale: 1.0 }),

        // Page Navigation
        nextPage: () => {
          const state = get();
          if (state.currentPage < state.numPages) {
            set({ currentPage: state.currentPage + 1 });
          }
        },

        prevPage: () => {
          const state = get();
          if (state.currentPage > 1) {
            set({ currentPage: state.currentPage - 1 });
          }
        },

        goToPage: (page) => {
          const state = get();
          set({ currentPage: Math.max(1, Math.min(page, state.numPages)) });
        },

  // UI Toggles
  toggleAnnotations: () => set((state) => ({ showAnnotations: !state.showAnnotations })),
  setAnnotationMode: (mode) => set({ annotationMode: mode }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarView: (view: 'annotations' | 'thumbnails') => set({ sidebarView: view }),
  setViewMode: (mode: 'continuous' | 'single' | 'two-page' | 'book' | 'presentation') => 
    set((state) => ({ ui: { ...state.ui, viewMode: mode } })),
  setPresentationMode: (enabled: boolean) => 
    set((state) => ({ ui: { ...state.ui, presentationMode: enabled } })),
  setSearchOpen: (open: boolean) => 
    set((state) => ({ ui: { ...state.ui, searchOpen: open } })),

        // Color Management
        setCurrentColor: (color) => set({ currentColor: color }),
        setCurrentOpacity: (opacity) => set({ currentOpacity: opacity }),

        // Text Selection
        setTextSelection: (selection) => set({ textSelection: selection }),
        
        createHighlightFromSelection: (comment) => {
          const state = get();
          if (!state.textSelection) return null;

          const { text, pageNumber, rects } = state.textSelection;
          
          // Calculate bounding box from text selection rects
          const minX = Math.min(...rects.map(r => r.left));
          const minY = Math.min(...rects.map(r => r.top));
          const maxX = Math.max(...rects.map(r => r.right));
          const maxY = Math.max(...rects.map(r => r.bottom));
          
          // Convert to relative coordinates (assuming page dimensions are available)
          // This would need to be adjusted based on actual page dimensions
          const position = {
            x: minX / window.innerWidth, // Placeholder - needs actual page width
            y: minY / window.innerHeight, // Placeholder - needs actual page height
            width: (maxX - minX) / window.innerWidth,
            height: (maxY - minY) / window.innerHeight,
          };

          const newId = get().addAnnotation({
            articleId: get().articleId || '',
            pageNumber,
            type: 'highlight',
            position,
            selectedText: text,
            color: 'hsl(var(--warning))',
            opacity: 0.4,
            status: 'active',
          } as Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'>);

          set({ 
            selectedAnnotationId: newId, 
            textSelection: null,
            annotationMode: 'select'
          });

          return newId;
        },

        // Getters
        getAnnotationsForPage: (page) => {
          return get().annotations.filter((a) => a.pageNumber === page && a.status === 'active');
        },

        getAnnotation: (id) => {
          return get().annotations.find((a) => a.id === id);
        },
      })),
      {
        name: 'pdf-viewer-storage',
        partialize: (state) => ({
          scale: state.scale,
          showAnnotations: state.showAnnotations,
          annotationMode: state.annotationMode,
          sidebarCollapsed: state.sidebarCollapsed,
          sidebarView: state.sidebarView,
        }),
      }
    ),
    { name: 'PDFStore' }
  )
);
