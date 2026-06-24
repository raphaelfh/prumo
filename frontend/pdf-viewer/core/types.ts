/**
 * Re-export of all type modules in the core/ directory.
 *
 * Convention: domain types live in their own files
 * (coordinates.ts, source.ts, engine.ts, state.ts).
 * This barrel is provided for consumers that prefer a single import.
 */

export type {PDFPoint, PDFRect, PDFTextRange} from './coordinates';

export type {
  PDFSource,
  PDFUrlSource,
  PDFDataSource,
  PDFLazySource,
} from './source';

export type {
  PDFEngine,
  PDFDocumentHandle,
  PDFPageHandle,
  PageRotation,
  LoadOptions,
  RenderOptions,
  RenderResult,
  TextLayerRenderOptions,
  TextLayerHandle,
  PDFMetadata,
  OutlineNode,
  TextContent,
  TextItem,
} from './engine';

export type {
  LoadStatus,
  ViewerState,
  ViewerActions,
  SearchMatch,
  SearchOptions,
  SearchState,
} from './state';
