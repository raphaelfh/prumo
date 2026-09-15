/**
 * The engine-free core. `RunSplitShell` imports `ViewerProvider` from here so
 * its module graph never pulls in pdf.js, and the app's page tests mock
 * `@prumo/pdf-viewer` with this module.
 */
export type {ViewerState} from './state';
export {createViewerStore} from './store';
export {subscribeReaderLocate} from './subscribeReaderLocate';
export {ViewerProvider} from './context';
