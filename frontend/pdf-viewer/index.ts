// Core: types, store, context
export * from './core';

// Compound primitives
export {Viewer, CanvasLayer, TextLayer} from './primitives';
export type {RootProps, CanvasLayerProps, TextLayerProps} from './primitives';

// UI shell components
export {
  Toolbar,
  NavigationControls,
  ZoomControls,
  LoadingState,
  ErrorState,
  SearchBar,
} from './ui';
export type {ErrorStateProps, SearchBarProps} from './ui';

// Hooks
export {useDocumentLoader} from './hooks/useDocumentLoader';
export {usePageHandle} from './hooks/usePageHandle';
export type {UseDocumentLoaderOptions} from './hooks/useDocumentLoader';

// High-level all-in-one component
export {PrumoPdfViewer} from './PrumoPdfViewer';
export type {PrumoPdfViewerProps} from './PrumoPdfViewer';

// Domain adapters (opt-in; consumers can also build their own)
export {
  articleFileSource,
  ArticleFileNotFoundError,
} from './adapters/articleFileSource';
export type {ArticleFileSourceOptions} from './adapters/articleFileSource';
