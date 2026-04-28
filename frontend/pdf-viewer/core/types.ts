/**
 * Re-export of all type modules in the core/ directory.
 *
 * Convention: domain types live in their own files
 * (coordinates.ts, source.ts, engine.ts, citation.ts, state.ts).
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
  Citation,
  CitationId,
  CitationAnchor,
  TextCitationAnchor,
  RegionCitationAnchor,
  HybridCitationAnchor,
  CitationMetadata,
  CitationStyle,
} from './citation';

export type {
  LoadStatus,
  ViewerState,
  ViewerActions,
  SearchMatch,
  SearchOptions,
  SearchState,
} from './state';
