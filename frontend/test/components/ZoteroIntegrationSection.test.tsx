import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {TooltipProvider} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';

vi.mock('@/hooks/useZoteroIntegration', () => ({useZoteroIntegration: vi.fn()}));

import {useZoteroIntegration} from '@/hooks/useZoteroIntegration';
import {ZoteroIntegrationSection} from '@/components/project/settings/ZoteroIntegrationSection';

type Hook = ReturnType<typeof useZoteroIntegration>;
const INTEGRATION = {
  id: 'z1', user_id: 'u1', zotero_user_id: '1301234353', library_type: 'user', is_active: true,
  last_sync_at: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
};
let hook: Hook;

function mockHook(over: Partial<Hook>) {
  hook = {
    integration: null, isConfigured: false, loading: false, testing: false,
    loadIntegration: vi.fn(), saveCredentials: vi.fn().mockResolvedValue(true),
    testConnection: vi.fn().mockResolvedValue({success: true}), disconnect: vi.fn().mockResolvedValue(true),
    ...over,
  } as unknown as Hook;
  vi.mocked(useZoteroIntegration).mockReturnValue(hook);
}

const renderSection = () => render(<TooltipProvider><ZoteroIntegrationSection /></TooltipProvider>);
const isGhost = (el: HTMLElement) => {
  expect(el).toHaveClass('active:bg-accent/80');
  expect(el).not.toHaveClass('border');
};

beforeEach(() => vi.clearAllMocks());

describe('ZoteroIntegrationSection', () => {
  it('is the Zotero group: h2 title, hint trigger, and the loading line inside it', () => {
    mockHook({loading: true});
    const {container} = renderSection();
    const title = t('user', 'integrationsZoteroTitle');
    expect(screen.getByRole('heading', {level: 2, name: title})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: t('common', 'fieldHintAria').replace('{{label}}', title)})).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('border-t');
    expect(container.firstElementChild).toHaveTextContent(t('project', 'zoteroLoading'));
  });

  it('connected: label and value sit in separate cells (no "User ID130...353" run-together)', () => {
    mockHook({isConfigured: true, integration: INTEGRATION});
    const {container} = renderSection();
    // No bordered status box (the Connected Badge is rounded-full, not rounded-md).
    expect(container.querySelector('.rounded-md.border')).toBeNull();
    const idLabel = screen.getByText(t('project', 'zoteroUserId'));
    const idValue = screen.getByText('130...353');
    expect(idLabel).toHaveTextContent(/^User ID$/);
    expect(idLabel.parentElement).not.toContainElement(idValue);
    expect(idValue.parentElement).toHaveTextContent(t('project', 'zoteroConnected'));
    const typeLabel = screen.getByText(t('project', 'zoteroLibraryType'));
    const typeValue = screen.getByText('user');
    expect(typeLabel.parentElement).not.toContainElement(typeValue);
    expect(screen.queryByText(t('project', 'zoteroLastSync'))).not.toBeInTheDocument();
  });

  it('connected: Last sync row appears when present; Test connection and Disconnect are ghost', async () => {
    mockHook({isConfigured: true, integration: {...INTEGRATION, last_sync_at: '2026-09-01T10:00:00Z'}});
    renderSection();
    expect(screen.getByText(t('project', 'zoteroLastSync'))).toBeInTheDocument();
    const test = screen.getByRole('button', {name: t('project', 'zoteroTestConnection')});
    isGhost(test);
    await userEvent.click(test);
    expect(hook.testConnection).toHaveBeenCalled();
    const disconnect = screen.getByRole('button', {name: t('project', 'zoteroDisconnect')});
    isGhost(disconnect);
    await userEvent.click(disconnect);
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', {name: t('project', 'zoteroDisconnect')}));
    expect(hook.disconnect).toHaveBeenCalled();
  });

  it('not connected: muted intro line, labelled quiet rows with hints, sibling Show/Hide, primary Connect', async () => {
    mockHook({});
    renderSection();
    expect(screen.getByText(t('project', 'zoteroConfigureDesc'))).toHaveClass('text-[13px]', 'text-muted-foreground');
    expect(screen.getByRole('link', {name: t('project', 'zoteroGenerateApiKey')})).toBeInTheDocument();

    const userId = screen.getByLabelText(t('project', 'zoteroUserIDLabel'));
    expect(userId).toHaveAccessibleDescription(t('project', 'zoteroUserIDHint'));
    expect(userId).not.toHaveClass('h-9');
    const howTo = screen.getByRole('link', {name: t('project', 'zoteroHowToFind')});
    expect(screen.getByText(t('project', 'zoteroUserIDLabel'))).not.toContainElement(howTo);

    const apiKey = screen.getByLabelText(t('project', 'zoteroApiKeyLabel'));
    expect(apiKey).toHaveAttribute('type', 'password');
    expect(apiKey).toHaveAccessibleDescription(t('project', 'zoteroApiKeyPermissions'));
    expect(apiKey).not.toHaveClass('pr-20');
    const show = screen.getByRole('button', {name: t('project', 'zoteroShow')});
    expect(show).not.toHaveClass('absolute');
    isGhost(show);
    await userEvent.click(show);
    expect(apiKey).toHaveAttribute('type', 'text');

    expect(screen.getByRole('combobox')).toBe(screen.getByLabelText(t('project', 'zoteroLibraryTypeLabel')));
    expect(screen.getByRole('combobox')).toHaveAttribute('id', 'library-type');

    const connect = screen.getByRole('button', {name: t('project', 'zoteroConnect')});
    expect(connect).toHaveClass('bg-primary');
    expect(connect).toBeDisabled();
    await userEvent.type(userId, '123456');
    await userEvent.type(apiKey, 'secret');
    await userEvent.click(connect);
    expect(hook.saveCredentials).toHaveBeenCalledWith({zoteroUserId: '123456', apiKey: 'secret', libraryType: 'user'});
  });
});
