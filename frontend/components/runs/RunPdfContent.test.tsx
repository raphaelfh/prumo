import {render} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

// This file imports the real RunPdfContent, whose import graph reaches
// `@/integrations/supabase/client`, where `createClient` runs at module scope.
// CI has no Supabase env, so without these stubs the file throws at import and
// never collects — green locally only because a worktree .env supplies them.
vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-anon-key');
});

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

describe('RunPdfContent — article DOI reaches the viewer as externalLink', () => {
  it('passes an externalLink pointing at doi.org when the article has a DOI', () => {
    mockArticleDetail.mockReturnValue({data: {doi: '10.1234/abcd'}});
    render(<RunPdfContent articleId="article-1" projectId="project-1" />);

    const props = pdfViewerSpy.mock.calls.at(-1)?.[0] as {
      externalLink?: {href: string};
    };
    expect(props.externalLink).toBeDefined();
    expect(props.externalLink?.href).toBe('https://doi.org/10.1234/abcd');
  });

  it('passes no externalLink when the article has no DOI', () => {
    mockArticleDetail.mockReturnValue({data: {doi: null}});
    render(<RunPdfContent articleId="article-2" projectId="project-1" />);

    const props = pdfViewerSpy.mock.calls.at(-1)?.[0] as {
      externalLink?: {href: string};
    };
    expect(props.externalLink).toBeUndefined();
  });
});
