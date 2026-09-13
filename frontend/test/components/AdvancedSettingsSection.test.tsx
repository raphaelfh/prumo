/** §7.5: `hasLlamaCloudKey` is true from a project-scope row when the viewer
 * is a manager and from a user-scope row otherwise. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/services/llmConnectionsService', () => ({
  fetchMyConnections: vi.fn(),
  fetchProjectConnections: vi.fn(),
}));
vi.mock('@/services/projectSettingsService', () => ({deleteProject: vi.fn()}));
vi.mock('@/services/parserSettingsService', () => ({setParserType: vi.fn()}));
vi.mock('react-router', async (importActual) => ({
  ...(await importActual<typeof import('react-router')>()),
  useNavigate: () => vi.fn(),
}));

import {fetchMyConnections, fetchProjectConnections} from '@/services/llmConnectionsService';
import {AdvancedSettingsSection} from '@/components/project/settings/AdvancedSettingsSection';
import {t} from '@/lib/copy';

const LLAMA = {id: 'c1', provider: 'llama_cloud', has_api_key: true} as never;
const PROJECT = {name: 'p', eligibility_criteria: null, study_design: null, review_keywords: [], settings: {}};

function renderSection(isManager: boolean) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(
    <QueryClientProvider client={client}>
      <AdvancedSettingsSection project={PROJECT} onChange={vi.fn()} projectId="p1" isManager={isManager} />
    </QueryClientProvider>,
  );
}

describe('AdvancedSettingsSection — llama_cloud key from connections', () => {
  it('a manager gets the key from the project-scope row', async () => {
    vi.mocked(fetchMyConnections).mockResolvedValue({ok: true, data: []});
    vi.mocked(fetchProjectConnections).mockResolvedValue({ok: true, data: [LLAMA]});
    renderSection(true);
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());
  });

  it('a non-manager gets the key from their own row and never reads the project list', async () => {
    vi.mocked(fetchMyConnections).mockResolvedValue({ok: true, data: [LLAMA]});
    vi.mocked(fetchProjectConnections).mockClear();
    renderSection(false);
    await waitFor(() => expect(screen.getByRole('switch')).toBeDisabled()); // disabled={!isManager} still wins
    await waitFor(() => expect(screen.getByText(t('parsing', 'highQualityHint'))).toBeInTheDocument());
    expect(fetchProjectConnections).not.toHaveBeenCalled();
  });
});
