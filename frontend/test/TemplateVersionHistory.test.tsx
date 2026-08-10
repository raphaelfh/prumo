/**
 * The History sheet (B-9e).
 *
 * Copy is deliberately NOT mocked: the sentences are what the manager
 * reads to decide whether a version is safe to restore over, so they are
 * part of the contract.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen} from '@testing-library/react';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/templateService', async () => {
  const {templateServiceMock} = await import('./mocks/templateService');
  return templateServiceMock();
});

import {TemplateVersionHistorySheet} from '@/components/extraction/template-config/TemplateVersionHistorySheet';
import {templateConfig} from '@/lib/copy';

import {loadTemplateVersionHistory} from './mocks/templateService';

function entry(overrides: Record<string, unknown> = {}) {
  return {
    version_id: 'v-1',
    version: 1,
    is_active: true,
    published_at: '2026-08-01T10:00:00Z',
    published_by: 'u-1',
    published_by_name: 'M. Costa',
    note: null,
    pinned_run_count: 0,
    ...overrides,
  };
}

function renderSheet() {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <TemplateVersionHistorySheet projectId="p1" templateId="t1" onClose={vi.fn()} />,
    {wrapper},
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TemplateVersionHistorySheet', () => {
  it('lists every version with its author and marks the current one', async () => {
    loadTemplateVersionHistory.mockResolvedValue({
      ok: true,
      data: {
        project_template_id: 't1',
        versions: [
          entry({version_id: 'v-2', version: 2, is_active: true}),
          entry({version_id: 'v-1', version: 1, is_active: false}),
        ],
      },
    });
    renderSheet();

    expect(await screen.findByTestId('template-version-2')).toBeInTheDocument();
    expect(screen.getByTestId('template-version-1')).toBeInTheDocument();
    expect(screen.getAllByText(/M\. Costa/)).toHaveLength(2);
    // Only the active version wears the badge.
    expect(screen.getAllByText(templateConfig.historyActiveBadge)).toHaveLength(1);
  });

  it("renders the publisher's note verbatim", async () => {
    // Migration 0052 added the column in B-9b2b and nothing displayed it
    // until now — this is the assertion that it reaches a screen.
    loadTemplateVersionHistory.mockResolvedValue({
      ok: true,
      data: {
        project_template_id: 't1',
        versions: [entry({note: 'dropped the unused EPV field'})],
      },
    });
    renderSheet();

    expect(
      await screen.findByText('dropped the unused EPV field'),
    ).toBeInTheDocument();
  });

  it('falls back to a word rather than showing a raw user id', async () => {
    loadTemplateVersionHistory.mockResolvedValue({
      ok: true,
      data: {
        project_template_id: 't1',
        versions: [entry({published_by_name: null})],
      },
    });
    renderSheet();

    expect(
      await screen.findByText(new RegExp(templateConfig.historyUnknownAuthor)),
    ).toBeInTheDocument();
    expect(screen.queryByText(/u-1/)).toBeNull();
  });

  it('singularises the pinned-run count', async () => {
    loadTemplateVersionHistory.mockResolvedValue({
      ok: true,
      data: {project_template_id: 't1', versions: [entry({pinned_run_count: 1})]},
    });
    renderSheet();

    expect(
      await screen.findByText(
        templateConfig.historyPinnedRunsOne.replace('{{n}}', '1'),
      ),
    ).toBeInTheDocument();
  });

  it('a FAILED read never renders as "never published"', async () => {
    // The bug this prevents: a dropped connection telling a manager their
    // template has no history, seconds before they publish over it.
    loadTemplateVersionHistory.mockResolvedValue({
      ok: false,
      error: {message: 'offline'},
    });
    renderSheet();

    expect(await screen.findByText(templateConfig.historyLoadFailed)).toBeInTheDocument();
    expect(screen.queryByText(templateConfig.historyEmpty)).toBeNull();
  });

  it('an empty timeline says so plainly', async () => {
    loadTemplateVersionHistory.mockResolvedValue({
      ok: true,
      data: {project_template_id: 't1', versions: []},
    });
    renderSheet();

    expect(await screen.findByText(templateConfig.historyEmpty)).toBeInTheDocument();
  });
});
