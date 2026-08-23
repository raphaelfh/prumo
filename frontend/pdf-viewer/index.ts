// Core: types, store, context
export * from './core';

// Compound primitives
export {Viewer, CanvasLayer, TextLayer, } from './primitives';
;

// UI shell components
export {
  Toolbar,
  NavigationControls,
  ZoomControls,
  LoadingState,
  ErrorState,
  
} from './ui';
;

// Hooks
export {useDocumentLoader} from './hooks/useDocumentLoader';
export {usePageHandle} from './hooks/usePageHandle';
;

// High-level all-in-one component
export {PrumoPdfViewer} from './PrumoPdfViewer';
;

// Domain adapters (opt-in; consumers can also build their own)
export {articleFileSourceFromStorageKey} from './adapters/articleFileSource';
;
