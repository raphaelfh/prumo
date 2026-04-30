import type {Citation, CitationId} from './citation';
import type {PDFDocumentHandle, PageRotation} from './engine';
import type {PDFSource} from './source';

/**
 * Document load status.
 *
 * Transitions: idle → loading → (ready | error). After error, calling
 * `setSource` with a new source resets to loading.
 */
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SearchMatch {
  pageNumber: number;
  charStart: number;
  charEnd: number;
  /** Surrounding text context of the match. */
  context: string;
}

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWords: boolean;
}

export interface SearchState {
  query: string;
  options: SearchOptions;
  matches: ReadonlyArray<SearchMatch>;
  /** Index in `matches` of the currently-active match, or -1 if none. */
  activeIndex: number;
  /** True while a search is in progress. */
  searching: boolean;
}

/**
 * The full viewer state.
 *
 * Convention: data fields are top-level; mutating actions live under
 * the `actions` namespace so consumers can subscribe to actions with
 * a stable reference (selector returns the same object across renders).
 */
/** Display mode — see `setMode` for semantics. */
export type ViewerMode = 'canvas' | 'reader';

export interface ViewerState {
  // Document
  source: PDFSource | null;
  document: PDFDocumentHandle | null;
  numPages: number;
  loadStatus: LoadStatus;
  error: Error | null;

  // Navigation
  /** 1-indexed current page. */
  currentPage: number;

  // Rendering
  /** Render scale. 1.0 = 100%. */
  scale: number;
  rotation: PageRotation;
  /**
   * Display mode. `canvas` (default) renders pages via the engine; `reader`
   * renders structured text blocks (typography-first, screen-reader friendly,
   * driven by `article_text_blocks` data fetched outside the viewer).
   */
  mode: ViewerMode;

  // Citations
  citations: ReadonlyMap<CitationId, Citation>;
  activeCitationId: CitationId | null;

  // Search
  search: SearchState;

  // Actions namespace — stable object reference across all updates.
  actions: ViewerActions;
}

export interface ViewerActions {
  // Document
  setSource(source: PDFSource | null): void;
  setDocument(doc: PDFDocumentHandle | null): void;
  setLoadStatus(status: LoadStatus, error?: Error | null): void;

  // Navigation
  goToPage(page: number): void;

  // Rendering
  setScale(scale: number): void;
  setRotation(rotation: PageRotation): void;
  setMode(mode: ViewerMode): void;

  // Citations
  addCitation(citation: Citation): void;
  removeCitation(id: CitationId): void;
  clearCitations(): void;
  setActiveCitation(id: CitationId | null): void;

  // Search
  setSearchQuery(query: string): void;
  setSearchOptions(opts: Partial<SearchOptions>): void;
  setSearchMatches(matches: ReadonlyArray<SearchMatch>): void;
  setSearchSearching(searching: boolean): void;
  goToNextMatch(): void;
  goToPrevMatch(): void;
  setActiveMatchIndex(index: number): void;
  clearSearch(): void;

  // Lifecycle
  /** Reset the store to its initial state. Calls `document.destroy()` if present. */
  reset(): void;
}
