/**
 * A template switch remounts the configuration editor (keyed by template id),
 * so editor-local state — the template instruction draft, panel selection,
 * undo history — never carries over and can never be saved into the next
 * template. The editor is stubbed with local state standing in for the draft.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {MemoryRouter} from 'react-router';
import {describe, expect, it, vi} from 'vitest';

// Envless CI has no VITE_SUPABASE_* — the real client module throws at import.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getUser: async () => ({data: {user: {id: 'user-1'}}, error: null})}},
}));
vi.mock('@/hooks/hitl/useProjectTemplates', () => ({
  useProjectTemplates: () => ({
    data: [
      {id: 'tpl-a', name: 'A', kind: 'extraction', is_active: true},
      {id: 'tpl-b', name: 'B', kind: 'extraction', is_active: true},
    ],
    isLoading: false,
    error: null,
  }),
  useInvalidateProjectTemplates: () => vi.fn(),
  useGlobalTemplateCatalogue: () => ({data: [], isPending: false}),
}));
vi.mock('@/hooks/extraction/useArticleExtractionValues', () => ({
  useArticleExtractionValues: () => ({valuesByArticle: new Map()}),
}));
vi.mock('@/hooks/extraction/useActiveTemplateStructure', () => ({
  useActiveTemplateStructure: () => ({entityTypes: [], isLoading: false, isError: false}),
}));
vi.mock('@/hooks/extraction/useTemplateRepublish', () => ({
  useTemplateConfigCaches: () => ({invalidateAfterImport: vi.fn()}),
}));
vi.mock('@/hooks/useProjectMemberRole', () => ({
  useProjectMemberRole: () => ({isManager: true, role: 'manager', loading: false}),
}));
vi.mock('@/contexts/AuthContext', () => ({useAuth: () => ({user: {id: 'user-1'}})}));
// The configuration tab's catalogue query would hit the stubbed supabase client.
vi.mock('@/services/templateService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/templateService')>()),
  loadGlobalTemplates: vi.fn(async () => ({ok: true, data: []})),
}));
vi.mock('@/services/articlesService', () => ({
  loadProjectArticles: vi.fn(() => new Promise(() => {})),
}));
vi.mock('@/components/extraction/ArticleExtractionTable', () => ({
  ArticleExtractionTable: () => <div data-testid="table-stub" />,
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
vi.mock('@/components/extraction/TemplateConfigEditor', () => ({
  TemplateConfigEditor: ({
    templateId,
    onActiveTemplateChanged,
  }: {
    templateId: string;
    onActiveTemplateChanged: (id: string) => void;
  }) => {
    const [draft, setDraft] = useState<string | null>(null);
    return (
      <div data-testid="editor-stub" data-template={templateId}>
        <input aria-label="draft" value={draft ?? ''} onChange={(e) => setDraft(e.target.value)} />
        <button type="button" onClick={() => onActiveTemplateChanged('tpl-b')}>
          switch
        </button>
      </div>
    );
  },
}));

import {ExtractionInterface} from '@/components/extraction/ExtractionInterface';

describe('ExtractionInterface template switch', () => {
  it('drops the editor-local instruction draft when the active template changes', async () => {
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/?extractionTab=configuration']}>
          <ExtractionInterface projectId="p1" />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const editor = await screen.findByTestId('editor-stub');
    expect(editor).toHaveAttribute('data-template', 'tpl-a');
    await userEvent.type(screen.getByLabelText('draft'), 'typed for A');

    await userEvent.click(screen.getByRole('button', {name: 'switch'}));

    expect(await screen.findByTestId('editor-stub')).toHaveAttribute('data-template', 'tpl-b');
    expect(screen.getByLabelText('draft')).toHaveValue('');
  });
});
