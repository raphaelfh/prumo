import {create} from 'zustand';
import {devtools, persist} from 'zustand/middleware';
import {immer} from 'zustand/middleware/immer';
import type {PDFDocumentProxy} from 'pdfjs-dist';

interface PDFState {
  // PDF State
  url: string | null;
  articleId: string | null;
  pdfDocument: PDFDocumentProxy | null;
  numPages: number;
  currentPage: number;
  scale: number;
  rotation: number;
  
  // UI State
  ui: {
    viewMode: 'continuous' | 'single' | 'two-page' | 'book' | 'presentation';
    presentationMode: boolean;
    searchOpen: boolean;
  };
  
  // Search State
  searchQuery: string;
  searchResults: Array<{
    pageNumber: number;
      matchIndex: number; // Index of specific match on the page
  }>;
  currentSearchIndex: number;
  
  // Actions
  setUrl: (url: string) => void;
  setArticleId: (articleId: string) => void;
  setPdfDocument: (doc: PDFDocumentProxy | null) => void;
  setNumPages: (pages: number) => void;
  setCurrentPage: (page: number) => void;
  setScale: (scale: number) => void;
  setRotation: (rotation: number) => void;
  
  // Helpers
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  nextPage: () => void;
  prevPage: () => void;
  goToPage: (page: number) => void;
  setViewMode: (mode: 'continuous' | 'single' | 'two-page' | 'book' | 'presentation') => void;
  setPresentationMode: (enabled: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: Array<{ pageNumber: number; matchIndex: number }>) => void;
  setCurrentSearchIndex: (index: number) => void;
  goToSearchResult: (index: number) => void;
  
  // Getters
  getPdfDocument: () => PDFDocumentProxy | null;
}

export const usePDFStore = create<PDFState>()(
  devtools(
    persist(
      immer((set, get) => ({
        // Initial State
        url: null,
        articleId: null,
        pdfDocument: null,
        numPages: 0,
        currentPage: 1,
          scale: 0.85, // Default: Fit to page
        rotation: 0,
        ui: {
          viewMode: 'continuous',
          presentationMode: false,
          searchOpen: false,
        },
        
        // Search State
        searchQuery: '',
        searchResults: [],
        currentSearchIndex: -1,

        // Basic Setters
        setUrl: (url) => set({ url }),
        setArticleId: (articleId) => set({ articleId }),
        setPdfDocument: (pdfDocument) => set({ pdfDocument }),
        setNumPages: (numPages) => set({ numPages }),
        setCurrentPage: (page) => set({ currentPage: Math.max(1, Math.min(page, get().numPages)) }),
        setScale: (scale) => set({ scale: Math.max(0.5, Math.min(scale, 3.0)) }),
        setRotation: (rotation) => set({ rotation: rotation % 360 }),

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
        setViewMode: (mode: 'continuous' | 'single' | 'two-page' | 'book' | 'presentation') => 
          set((state) => ({ ui: { ...state.ui, viewMode: mode } })),
        setPresentationMode: (enabled: boolean) => 
          set((state) => ({ ui: { ...state.ui, presentationMode: enabled } })),
        setSearchOpen: (open: boolean) => 
          set((state) => ({ ui: { ...state.ui, searchOpen: open } })),
        
        // Search Actions
        setSearchQuery: (query) => set({ searchQuery: query }),
        setSearchResults: (results) => set({ searchResults: results }),
        setCurrentSearchIndex: (index) => set({ currentSearchIndex: index }),
        goToSearchResult: (index) => {
          const state = get();
          if (index >= 0 && index < state.searchResults.length) {
            const result = state.searchResults[index];
            set({ currentSearchIndex: index, currentPage: result.pageNumber });
          }
        },

        // Getters
        getPdfDocument: () => {
          return get().pdfDocument;
        },
      })),
      {
        name: 'pdf-viewer-storage',
        partialize: (state) => ({
          scale: state.scale,
        }),
      }
    ),
    { name: 'PDFStore' }
  )
);
