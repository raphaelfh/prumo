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

/**
 * The full viewer state.
 *
 * Convention: data fields are top-level; mutating actions live under
 * the `actions` namespace so consumers can subscribe to actions with
 * a stable reference (selector returns the same object across renders).
 */
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

  // Citations
  citations: ReadonlyMap<CitationId, Citation>;
  activeCitationId: CitationId | null;

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

  // Citations
  addCitation(citation: Citation): void;
  removeCitation(id: CitationId): void;
  clearCitations(): void;
  setActiveCitation(id: CitationId | null): void;

  // Lifecycle
  /** Reset the store to its initial state. Calls `document.destroy()` if present. */
  reset(): void;
}
