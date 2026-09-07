/**
 * `/settings` inside the shell.
 *
 * Spec §1's defect was that this page carried its own title and back arrow —
 * "a third navigation model". The breadcrumb names the page now and the
 * sidebar is the way back, so the page must offer neither; that absence is
 * asserted positively (an empty page-header apart from the description, and no
 * buttons at all beside the tabs) rather than by hoping a string is missing.
 */
import {describe, expect, it, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter, useLocation} from 'react-router';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('@/components/user/ProfileSection', () => ({ProfileSection: () => <div>profile section</div>}));
vi.mock('@/components/user/SecuritySection', () => ({SecuritySection: () => <div>security section</div>}));
vi.mock('@/components/user/IntegrationsSection', () => ({IntegrationsSection: () => <div>integrations section</div>}));

import UserSettings from '@/pages/UserSettings';

function UrlProbe() {
  const location = useLocation();
  return <output data-testid="url">{`${location.pathname}${location.search}`}</output>;
}

function renderSettings(path = '/settings') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <UserSettings />
      <UrlProbe />
    </MemoryRouter>,
  );
}

describe('UserSettings', () => {
  it('opens on Profile and marks it selected', () => {
    renderSettings();

    expect(screen.getByRole('tab', {name: 'tabProfile'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', {name: 'tabSecurity'})).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('profile section')).toBeInTheDocument();
  });

  it('names its tablist for assistive tech', () => {
    renderSettings();

    expect(screen.getByRole('tablist', {name: 'settingsAriaSections'})).toBeInTheDocument();
  });

  it('honours a deep link to a tab', () => {
    renderSettings('/settings?tab=integrations');

    expect(screen.getByRole('tab', {name: 'tabIntegrations'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('integrations section')).toBeInTheDocument();
  });

  it('falls back to Profile for an unknown tab', () => {
    renderSettings('/settings?tab=bogus');

    expect(screen.getByRole('tab', {name: 'tabProfile'})).toHaveAttribute('aria-selected', 'true');
  });

  it('switching a tab swaps the panel and writes ?tab=', async () => {
    renderSettings();

    await userEvent.click(screen.getByRole('tab', {name: 'tabSecurity'}));

    expect(screen.getByText('security section')).toBeInTheDocument();
    expect(screen.queryByText('profile section')).toBeNull();
    expect(screen.getByTestId('url')).toHaveTextContent('/settings?tab=security');
  });

  it('shows the active tab description and no page title beside it', () => {
    const {container} = renderSettings();

    const header = container.querySelector('[data-slot="page-header"]') as HTMLElement;
    // Exactly the description — the breadcrumb owns the page name now.
    expect(header.textContent).toBe('tabProfileDesc');
  });

  it('offers no back control — the sidebar is the way back', () => {
    renderSettings();

    // The three tabs are role="tab", so a surviving back arrow would be the
    // only role="button" on the page.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('does not clone the shell sidebar panel skin on its rail', () => {
    renderSettings();

    const rail = screen.getByRole('tablist', {name: 'settingsAriaSections'});
    // This rail is page sub-navigation, not a second sidebar (see file
    // header). A panel background or panel border here recreates the
    // "two same-skinned panes" violation the fold-in was meant to remove.
    expect(rail.className).not.toContain('bg-[#fafafa]');
    expect(rail.className).not.toContain('dark:bg-[#0c0c0c]');
    expect(rail.className).not.toMatch(/(?:^|\s)border-r(?:\s|$)/);
  });
});
