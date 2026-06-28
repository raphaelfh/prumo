import {createStore, type StoreApi} from 'zustand';
import type {PDFDocumentHandle, PageRotation} from './engine';
import type {PDFSource} from './source';
import type {LoadStatus, SearchState, ViewerActions, ViewerMode, ViewerState} from './state';

type ViewerData = Omit<ViewerState, 'actions'>;

const initialSearch: SearchState = {
  query: '',
  options: {caseSensitive: false, wholeWords: false},
  matches: [],
  matchCount: 0,
  activeIndex: -1,
  searching: false,
};

/**
 * Drop computed results (matches/count/active) but keep the query + options.
 * Used on a mode switch: canvas matches (PDF coords + TextLayer) and reader
 * matches (DOM Ranges) are disjoint, so carrying a count across modes leaves a
 * stale "n / N" with live prev/next firing against the now-hidden surface.
 */
const clearedResults = (s: SearchState): SearchState => ({
  ...s,
  matches: [],
  matchCount: 0,
  activeIndex: -1,
});

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
  readerLocate: null,
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
    // (not just module defaults).
    const buildResetState = (): ViewerData => ({
      ...initialData,
      ...initial,
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
        if (mode === get().mode) return;
        set({mode, search: clearedResults(get().search)});
      },

      locateInReader(quote: string, page?: number | null, blockIds: number[] = []) {
        const prevNonce = get().readerLocate?.nonce ?? 0;
        const switchingFromCanvas = get().mode !== 'reader';
        set({
          mode: 'reader',
          readerLocate: {quote, page: page ?? null, blockIds, nonce: prevNonce + 1},
          ...(switchingFromCanvas ? {search: clearedResults(get().search)} : {}),
        });
      },

      clearReaderLocate() {
        set({readerLocate: null});
      },

      setSearchQuery(query: string) {
        set({search: {...get().search, query}});
      },

      setSearchOptions(opts) {
        set({search: {...get().search, options: {...get().search.options, ...opts}}});
      },

      setSearchMatches(matches) {
        set({
          search: {
            ...get().search,
            matches,
            matchCount: matches.length,
            activeIndex: matches.length > 0 ? 0 : -1,
          },
        });
      },

      setReaderMatchCount(count: number) {
        set({
          search: {
            ...get().search,
            matches: [],
            matchCount: count,
            activeIndex: count > 0 ? 0 : -1,
          },
        });
      },

      setSearchSearching(searching: boolean) {
        set({search: {...get().search, searching}});
      },

      goToNextMatch() {
        const s = get().search;
        if (s.matchCount === 0) return;
        const next = (s.activeIndex + 1) % s.matchCount;
        set({search: {...s, activeIndex: next}});
        // Canvas matches carry a page; bring it into view. Reader matches live
        // in the DOM (no `matches` entry) and are scrolled by the reader itself.
        const match = s.matches[next];
        if (match) get().actions.goToPage(match.pageNumber);
      },

      goToPrevMatch() {
        const s = get().search;
        if (s.matchCount === 0) return;
        const next = (s.activeIndex - 1 + s.matchCount) % s.matchCount;
        set({search: {...s, activeIndex: next}});
        const match = s.matches[next];
        if (match) get().actions.goToPage(match.pageNumber);
      },

      setActiveMatchIndex(index: number) {
        const s = get().search;
        if (index < -1 || index >= s.matchCount) return;
        set({search: {...s, activeIndex: index}});
        const match = index >= 0 ? s.matches[index] : undefined;
        if (match) get().actions.goToPage(match.pageNumber);
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
