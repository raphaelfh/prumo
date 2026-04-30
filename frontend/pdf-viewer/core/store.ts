import {createStore, type StoreApi} from 'zustand';
import type {Citation, CitationId} from './citation';
import type {PDFDocumentHandle, PageRotation} from './engine';
import type {PDFSource} from './source';
import type {LoadStatus, SearchState, ViewerActions, ViewerMode, ViewerState} from './state';

type ViewerData = Omit<ViewerState, 'actions'>;

const initialSearch: SearchState = {
  query: '',
  options: {caseSensitive: false, wholeWords: false},
  matches: [],
  activeIndex: -1,
  searching: false,
};

const initialData: ViewerData = {
  source: null,
  document: null,
  numPages: 0,
  loadStatus: 'idle',
  error: null,
  currentPage: 1,
  scale: 1,
  rotation: 0,
  mode: 'canvas',
  citations: new Map<CitationId, Citation>(),
  activeCitationId: null,
  search: initialSearch,
};

/**
 * Create a fresh viewer store. Each call returns an isolated `StoreApi`;
 * two stores never share state. This is the multi-instance entry point.
 *
 * The returned `StoreApi` is the vanilla Zustand contract — pass it to
 * `useStore(store, selector)` to subscribe in React, or call
 * `store.getState()` / `store.setState()` directly.
 */
export function createViewerStore(
  initial?: Partial<ViewerData>,
): StoreApi<ViewerState> {
  return createStore<ViewerState>((set, get) => {
    // Captured once so reset() restores caller-supplied overrides
    // (not just module defaults) and uses a fresh citations Map
    // to avoid sharing references across stores.
    const buildResetState = (): ViewerData => ({
      ...initialData,
      ...initial,
      citations: new Map<CitationId, Citation>(),
    });

    const actions: ViewerActions = {
      setSource(source: PDFSource | null) {
        set({source});
      },

      setDocument(doc: PDFDocumentHandle | null) {
        set({
          document: doc,
          numPages: doc?.numPages ?? 0,
        });
      },

      setLoadStatus(status: LoadStatus, error?: Error | null) {
        set({
          loadStatus: status,
          error: status === 'error' ? (error ?? null) : null,
        });
      },

      goToPage(page: number) {
        const {numPages} = get();
        const clamped = numPages > 0
          ? Math.max(1, Math.min(page, numPages))
          : Math.max(1, page);
        set({currentPage: clamped});
      },

      setScale(scale: number) {
        set({scale});
      },

      setRotation(rotation: PageRotation) {
        set({rotation});
      },

      setMode(mode: ViewerMode) {
        set({mode});
      },

      addCitation(citation: Citation) {
        const next = new Map(get().citations);
        next.set(citation.id, citation);
        set({citations: next});
      },

      removeCitation(id: CitationId) {
        const next = new Map(get().citations);
        next.delete(id);
        set({citations: next});
      },

      clearCitations() {
        set({
          citations: new Map<CitationId, Citation>(),
          activeCitationId: null,
        });
      },

      setActiveCitation(id: CitationId | null) {
        set({activeCitationId: id});
      },

      setSearchQuery(query: string) {
        set({search: {...get().search, query}});
      },

      setSearchOptions(opts) {
        set({search: {...get().search, options: {...get().search.options, ...opts}}});
      },

      setSearchMatches(matches) {
        set({search: {...get().search, matches, activeIndex: matches.length > 0 ? 0 : -1}});
      },

      setSearchSearching(searching: boolean) {
        set({search: {...get().search, searching}});
      },

      goToNextMatch() {
        const s = get().search;
        if (s.matches.length === 0) return;
        const next = (s.activeIndex + 1) % s.matches.length;
        set({search: {...s, activeIndex: next}});
        get().actions.goToPage(s.matches[next].pageNumber);
      },

      goToPrevMatch() {
        const s = get().search;
        if (s.matches.length === 0) return;
        const next = (s.activeIndex - 1 + s.matches.length) % s.matches.length;
        set({search: {...s, activeIndex: next}});
        get().actions.goToPage(s.matches[next].pageNumber);
      },

      setActiveMatchIndex(index: number) {
        const s = get().search;
        if (index < -1 || index >= s.matches.length) return;
        set({search: {...s, activeIndex: index}});
        if (index >= 0) get().actions.goToPage(s.matches[index].pageNumber);
      },

      clearSearch() {
        set({search: initialSearch});
      },

      reset() {
        const {document} = get();
        document?.destroy();
        set(buildResetState());
      },
    };

    return {
      ...initialData,
      ...initial,
      actions,
    };
  });
}
