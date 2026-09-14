/**
 * The extraction worklist hands the engine gear to the table's `toolbarActions`
 * slot. The table is stubbed to render that prop, so this test pins the mount
 * point (the real table renders it in all three of its branches).
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, within} from '@testing-library/react';
import type {ReactNode} from 'react';
import {MemoryRouter} from 'react-router';
import {describe, expect, it, vi} from 'vitest';

// Envless CI has no VITE_SUPABASE_* — the real client module throws at import.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getUser: async () => ({data: {user: {id: 'user-1'}}, error: null})}},
}));
vi.mock('@/hooks/hitl/useProjectTemplates', () => ({
  useProjectTemplates: () => ({
    data: [{id: 'tpl-1', name: 'T', kind: 'extraction', is_active: true}],
    isLoading: false,
    error: null,
    isError: false, refetch: vi.fn(),
  }),
  useInvalidateProjectTemplates: () => vi.fn(),
  useGlobalTemplateCatalogue: () => ({data: [], isPending: false}),
}));
vi.mock('@/hooks/extraction/useArticleExtractionValues', () => ({
  useArticleExtractionValues: () => ({valuesByArticle: new Map(), isLoading: false, isError: false, isUnavailable: false, refetch: vi.fn()}),
}));
vi.mock('@/hooks/extraction/useActiveTemplateStructure', () => ({
  useActiveTemplateStructure: () => ({entityTypes: [], isLoading: false, isError: false, error: null, refetch: vi.fn()}),
}));
vi.mock('@/contexts/AuthContext', () => ({useAuth: () => ({user: {id: 'user-1'}, loading: false})}));
vi.mock('@/services/articlesService', () => ({
  fetchProjectArticles: vi.fn(() => new Promise(() => {})),
}));
vi.mock('@/hooks/extraction/useTemplateRepublish', () => ({
  useTemplateConfigCaches: () => ({invalidateAfterImport: vi.fn()}),
}));
vi.mock('@/hooks/useProjectMemberRole', () => ({
  useProjectMemberRole: () => ({isManager: false, role: 'reviewer', loading: false}),
}));
vi.mock('@/components/extraction/ArticleExtractionTable', () => ({
  ArticleExtractionTable: ({toolbarActions}: {toolbarActions: ReactNode}) => (
    <div data-testid="table-stub">{toolbarActions}</div>
  ),
}));
vi.mock('@/hooks/extraction/useLlmEngine', () => ({
  useLlmEngine: () => ({data: undefined, isPending: true, isError: false, refetch: vi.fn()}),
  useSetMyEngine: () => ({mutate: vi.fn(), isPending: false}),
  useClearMyEngine: () => ({mutate: vi.fn(), isPending: false}),
}));
vi.mock('@/hooks/user/useLlmConnections', () => ({
  useProviders: () => ({data: []}),
  useMyConnections: () => ({data: []}),
}));

import {ExtractionInterface} from '@/components/extraction/ExtractionInterface';

describe('ExtractionInterface toolbar', () => {
  it('hands the engine gear to the article table toolbar slot', async () => {
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ExtractionInterface projectId="p1" />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const gear = await screen.findByTestId('engine-gear');
    expect(within(screen.getByTestId('table-stub')).getByTestId('engine-gear')).toBe(gear);
  });
});
