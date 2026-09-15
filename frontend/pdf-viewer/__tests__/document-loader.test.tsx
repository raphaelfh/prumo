import {renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {describe, expect, it, vi} from 'vitest';

// useDocumentLoader imports the pdf.js engine as its default.
import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';
import {createMockEngine} from '../engines/mock';

const {useDocumentLoader} = await import('../hooks/useDocumentLoader');

describe('useDocumentLoader', () => {
  it('knows page 1’s size by the time the document is ready', async () => {
    const store = createViewerStore();
    const sizesWhenReady: unknown[] = [];
    store.subscribe((state, prev) => {
      if (state.loadStatus === 'ready' && prev.loadStatus !== 'ready') sizesWhenReady.push(state.pageSizes[1]);
    });
    const engine = createMockEngine({numPages: 3, pageSize: {width: 500, height: 700}});
    const source = {kind: 'url' as const, url: 'mock.pdf'};
    const wrapper = ({children}: {children: ReactNode}) => <ViewerProvider store={store}>{children}</ViewerProvider>;

    renderHook(() => useDocumentLoader({source, engine}), {wrapper});

    await waitFor(() => expect(store.getState().loadStatus).toBe('ready'));
    expect(sizesWhenReady).toEqual([{width: 500, height: 700}]);
  });
});
