/**
 * `@prumo/pdf-viewer` — the viewer's public surface: exactly what the app
 * imports. Modules inside the viewer import each other by path.
 */
export {createViewerStore, subscribeReaderLocate, type ViewerState} from './core';
export {PrumoPdfViewer} from './PrumoPdfViewer';
export {articleFileSourceFromStorageKey} from './adapters/articleFileSource';
