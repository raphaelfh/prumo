import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuidv4 } from 'uuid';
import type { Annotation, AnnotationType, DrawingState } from '@/types/annotation';

interface PDFState {
  // PDF State
  url: string | null;
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
  
  // UI State
  showAnnotations: boolean;
  annotationMode: 'select' | 'highlight' | 'area';
  sidebarCollapsed: boolean;
  sidebarView: 'annotations' | 'thumbnails';
  
  // History
  history: Annotation[][];
  historyIndex: number;
  
  // Actions
  setUrl: (url: string) => void;
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
  setAnnotationMode: (mode: 'select' | 'highlight' | 'area') => void;
  toggleSidebar: () => void;
  setSidebarView: (view: 'annotations' | 'thumbnails') => void;
  
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
        showAnnotations: true,
        annotationMode: 'select',
        sidebarCollapsed: false,
        sidebarView: 'annotations',
        history: [],
        historyIndex: -1,

        // Basic Setters
        setUrl: (url) => set({ url }),
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
              createdAt: now,
              updatedAt: now,
              status: 'active',
            };
            
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
        startDrawing: (x, y, page) =>
          set({
            isDrawing: true,
            drawingState: { start: { x, y, page } },
          }),

        updateDrawing: (x, y) =>
          set((state) => {
            if (state.drawingState) {
              state.drawingState.current = { x, y };
            }
          }),

        finishDrawing: (comment) => {
          const state = get();
          if (!state.drawingState) return;

          const { start, current } = state.drawingState;
          if (!current) return;

          // Calculate relative position
          const x = Math.min(start.x, current.x);
          const y = Math.min(start.y, current.y);
          const width = Math.abs(current.x - start.x);
          const height = Math.abs(current.y - start.y);

          // Only create if significant size
          if (width > 0.01 && height > 0.01) {
            const currentState = get();
            const isHighlight = currentState.annotationMode === 'highlight';

            const newId = get().addAnnotation({
              pageNumber: start.page,
              type: isHighlight ? 'highlight' : 'area',
              position: { x, y, width, height },
              comment: comment || '',
              color: isHighlight ? 'hsl(var(--warning))' : 'hsl(var(--primary))',
              opacity: isHighlight ? 0.4 : 0.3,
              status: 'active',
            });

            set({ selectedAnnotationId: newId });
          }

          set({
            isDrawing: false,
            drawingState: null,
          });
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

          // Update annotation position
          set((draft) => {
            const ann = draft.annotations.find(a => a.id === state.dragState!.id);
            if (ann) {
              ann.position = {
                ...ann.position,
                x: x - state.dragState!.offsetX,
                y: y - state.dragState!.offsetY,
              };
              ann.updatedAt = new Date().toISOString();
            }
          });
        },

        finishDragging: () =>
          set({
            isDragging: false,
            dragState: null,
          }),

        cancelDragging: () =>
          set({
            isDragging: false,
            dragState: null,
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
