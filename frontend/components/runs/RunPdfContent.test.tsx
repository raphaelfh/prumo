import {render} from '@testing-library/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {describe, expect, it, vi} from 'vitest';

import {RunPdfContent} from './RunPdfContent';

const pdfViewerSpy = vi.fn();

vi.mock('@prumo/pdf-viewer', () => ({
  PrumoPdfViewer: (props: unknown) => {
    pdfViewerSpy(props);
    return <div data-testid="pdf-viewer-stub" />;
  },
}));

vi.mock('@/hooks/extraction/useArticleDocuments', () => ({
  useArticleDocuments: () => ({
    files: [],
    selectedFileId: null,
    setSelectedFileId: vi.fn(),
    selectedFile: null,
    source: null,
    readerBlocks: [],
    readerLoading: false,
  }),
}));

const mockArticleDetail = vi.fn();
vi.mock('@/hooks/extraction/useArticleDetail', () => ({
  useArticleDetail: () => mockArticleDetail(),
}));

/** The re-parse control's mutation hook runs on every render, file or not. */
function renderPanel(articleId: string) {
  const client = new QueryClient({defaultOptions: {mutations: {retry: false}}});
  return render(
    <QueryClientProvider client={client}>
      <RunPdfContent articleId={articleId} projectId="project-1" />
    </QueryClientProvider>,
  );
}

describe('RunPdfContent — article DOI reaches the viewer as externalLink', () => {
  it('passes an externalLink pointing at doi.org when the article has a DOI', () => {
    mockArticleDetail.mockReturnValue({data: {doi: '10.1234/abcd'}});
    renderPanel('article-1');

    const props = pdfViewerSpy.mock.calls.at(-1)?.[0] as {
      externalLink?: {href: string};
    };
    expect(props.externalLink).toBeDefined();
    expect(props.externalLink?.href).toBe('https://doi.org/10.1234/abcd');
  });

  it('passes no externalLink when the article has no DOI', () => {
    mockArticleDetail.mockReturnValue({data: {doi: null}});
    renderPanel('article-2');

    const props = pdfViewerSpy.mock.calls.at(-1)?.[0] as {
      externalLink?: {href: string};
    };
    expect(props.externalLink).toBeUndefined();
  });
});
