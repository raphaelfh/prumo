import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, within} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {TooltipProvider} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';

vi.mock('@/services/llmConnectionsService', () => ({
  fetchMyConnections: vi.fn(),
  fetchProviders: vi.fn(),
  fetchProjectConnections: vi.fn(),
  createMyConnection: vi.fn(),
  deleteMyConnection: vi.fn(),
  verifyMyConnection: vi.fn(),
}));
vi.mock('@/hooks/useZoteroIntegration', () => ({useZoteroIntegration: vi.fn()}));
vi.mock('@/services/personalAccessTokenService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/personalAccessTokenService')>()),
  fetchMyTokens: vi.fn(),
  createMyToken: vi.fn(),
  revokeMyToken: vi.fn(),
}));

import * as svc from '@/services/llmConnectionsService';
import * as patSvc from '@/services/personalAccessTokenService';
import {useZoteroIntegration} from '@/hooks/useZoteroIntegration';
import {IntegrationsSection} from '@/components/user/IntegrationsSection';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(svc.fetchMyConnections).mockResolvedValue({ok: true, data: []});
  vi.mocked(svc.fetchProviders).mockResolvedValue({ok: true, data: []});
  vi.mocked(patSvc.fetchMyTokens).mockResolvedValue({ok: true, data: []});
  vi.mocked(useZoteroIntegration).mockReturnValue({
    integration: null, isConfigured: false, loading: false, testing: false,
    loadIntegration: vi.fn(), saveCredentials: vi.fn(), testConnection: vi.fn(), disconnect: vi.fn(),
  } as unknown as ReturnType<typeof useZoteroIntegration>);
});

describe('IntegrationsSection', () => {
  it('renders one SettingsPage whose body holds exactly the three groups', () => {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
    const {container} = render(
      <QueryClientProvider client={client}><TooltipProvider><IntegrationsSection /></TooltipProvider></QueryClientProvider>,
    );
    expect(container.firstElementChild).toHaveClass('max-w-3xl');
    const body = container.querySelector('[class~="@container/settings"]');
    expect(body).not.toBeNull();
    const groups = Array.from(body!.children);
    expect(groups).toHaveLength(3);
    groups.forEach((g) => expect(g).toHaveClass('border-t'));
    expect(within(groups[0] as HTMLElement).getByRole('heading', {level: 2, name: t('llmConnections', 'integrationsTitle')})).toBeInTheDocument();
    expect(within(groups[1] as HTMLElement).getByRole('heading', {level: 2, name: t('user', 'integrationsZoteroTitle')})).toBeInTheDocument();
    expect(within(groups[2] as HTMLElement).getByRole('heading', {level: 2, name: t('personalAccessTokens', 'groupTitle')})).toBeInTheDocument();
    expect(container.querySelector('.space-y-8')).toBeNull();
    expect(screen.getAllByRole('heading', {level: 2})).toHaveLength(3);
  });
});
