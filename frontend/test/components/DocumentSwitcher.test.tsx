/**
 * Tests for DocumentSwitcher (presentational document selector).
 *
 * Covers:
 *  - renders nothing when the article has no files
 *  - shows the selected file's label in the trigger
 */
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));
vi.mock('@/services/articlesService', () => ({
  reparseArticleFile: vi.fn(),
}));

import {DocumentSwitcher} from '@/components/extraction/DocumentSwitcher';
import type {ArticleFileListItem} from '@/services/articleFilesService';

function file(
  id: string,
  fileRole: string,
  originalFilename: string,
  extractionStatus = 'parsed',
): ArticleFileListItem {
  return {
    id,
    fileRole,
    fileType: 'PDF',
    originalFilename,
    extractionStatus,
    bytes: 1,
    storageKey: `k/${id}.pdf`,
    createdAt: '2026-06-21T00:00:00Z',
  };
}

describe('DocumentSwitcher', () => {
  it('renders nothing when there are no files', () => {
    const {container} = render(
      <DocumentSwitcher files={[]} selectedFileId={null} onSelect={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the selected file label in the trigger', () => {
    const files = [
      file('main-1', 'MAIN', 'main.pdf'),
      file('supp-1', 'SUPPLEMENT', 'supp.pdf', 'pending'),
    ];
    render(
      <DocumentSwitcher
        files={files}
        selectedFileId="main-1"
        onSelect={() => {}}
      />,
    );
    // The trigger renders the selected file's label explicitly (not via the
    // unmounted Radix item list).
    expect(screen.getByText('main.pdf')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveAttribute(
      'aria-label',
      'docSwitcherAria',
    );
  });
});
