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
  /**
   * Canvas-mode matches with PDF coordinates. Empty in reader mode — the
   * reader's matches are DOM Ranges owned by the reader, not the store.
   */
  matches: ReadonlyArray<SearchMatch>;
  /**
   * Total match count for the ACTIVE mode (canvas = `matches.length`,
   * reader = the reader's DOM-match count). The mode-agnostic field the
   * search bar reads for its "n / N" label and prev/next enabling.
   */
  matchCount: number;
  /** Index of the currently-active match (into `matchCount`), or -1 if none. */
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

/**
 * A request to locate a quote inside the reader (markdown) view.
 *
 * Citation locating is markdown-first: rather than projecting a fragile PDF
 * bbox, the reader finds the block whose text contains `quote`, scrolls it into
 * view, and flashes it. `nonce` makes repeated locates of the same quote
 * re-trigger (a plain value change wouldn't).
 */
export interface ReaderLocateRequest {
  quote: string;
  /** 1-indexed page hint, or null when unknown. */
  page: number | null;
  /** block_index values for deterministic reader highlight (preferred over quote). */
  blockIds: number[];
  /** Monotonically increasing — bump to re-fire the same quote. */
  nonce: number;
}

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

  /**
   * Pending reader-locate request (markdown-first citation locating). The
   * reader primitive consumes this to scroll + flash the matching block.
   */
  readerLocate: ReaderLocateRequest | null;

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

  // Reader-locate (markdown-first citation locating)
  /** Switch to reader mode and request the reader to find + flash `quote`. */
  locateInReader(quote: string, page?: number | null, blockIds?: number[]): void;
  /** Clear any pending reader-locate request (e.g. on document switch). */
  clearReaderLocate(): void;

  // Search
  setSearchQuery(query: string): void;
  setSearchOptions(opts: Partial<SearchOptions>): void;
  setSearchMatches(matches: ReadonlyArray<SearchMatch>): void;
  /**
   * Reader-mode search result: record the DOM-match count (the Ranges live in
   * the reader). Clears any canvas matches and activates the first match.
   */
  setReaderMatchCount(count: number): void;
  setSearchSearching(searching: boolean): void;
  goToNextMatch(): void;
  goToPrevMatch(): void;
  setActiveMatchIndex(index: number): void;
  clearSearch(): void;

  // Lifecycle
  /** Reset the store to its initial state. Calls `document.destroy()` if present. */
  reset(): void;
}
