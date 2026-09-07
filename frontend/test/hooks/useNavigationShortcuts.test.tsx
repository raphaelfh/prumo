/**
 * Real keydowns against the real hook.
 *
 * Ledger discrepancy D: `G P`'s handler closed over `useState` in
 * `ProjectLayout`, which never mounts on `/`, so NO `G`-chord fired there and
 * nothing anywhere failed. That is why the assertions below press keys instead
 * of inspecting the bindings array, and why the negative cases carry a
 * positive control in the same render — "nothing happened" must mean the gate
 * held, not that the listener was dead.
 */
import {describe, expect, it, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter, useLocation} from 'react-router';
import {modifierKey} from '@/lib/platform';
import {useNavigationShortcuts} from '@/hooks/useNavigationShortcuts';

/** Whichever modifier this machine's platform helper actually binds. */
const MOD = modifierKey() === 'metaKey' ? 'Meta' : 'Control';

interface HarnessProps {
  projectId: string | null;
  onToggleSidebar: () => void;
  onOpenProjectSwitcher: () => void;
}

function Harness({projectId, onToggleSidebar, onOpenProjectSwitcher}: HarnessProps) {
  useNavigationShortcuts({projectId, onToggleSidebar, onOpenProjectSwitcher});
  const location = useLocation();
  return <output data-testid="url">{`${location.pathname}${location.search}`}</output>;
}

function renderAt(path: string, projectId: string | null) {
  const onToggleSidebar = vi.fn();
  const onOpenProjectSwitcher = vi.fn();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Harness
        projectId={projectId}
        onToggleSidebar={onToggleSidebar}
        onOpenProjectSwitcher={onOpenProjectSwitcher}
      />
    </MemoryRouter>,
  );
  return {
    onToggleSidebar,
    onOpenProjectSwitcher,
    url: () => screen.getByTestId('url').textContent,
  };
}

describe('useNavigationShortcuts', () => {
  it('G H reaches the hub from a route with no project', async () => {
    const nav = renderAt('/settings', null);

    await userEvent.keyboard('gh');

    expect(nav.url()).toBe('/');
  });

  it('the sidebar chord is registered where no project matched', async () => {
    // Discrepancy D in one line: this used to be registered only inside a
    // layout that never mounted on `/`.
    const nav = renderAt('/', null);

    await userEvent.keyboard(`{${MOD}>}b{/${MOD}}`);

    expect(nav.onToggleSidebar).toHaveBeenCalledTimes(1);
  });

  it('G <letter> opens the matching project section when a project id matched', async () => {
    const nav = renderAt('/projects/p1?tab=articles', 'p1');

    await userEvent.keyboard('ge');

    expect(nav.url()).toBe('/projects/p1?tab=extraction');
  });

  it('G <letter> is not bound without a project id — and the listener is live', async () => {
    const nav = renderAt('/settings', null);

    await userEvent.keyboard('ge');
    expect(nav.url()).toBe('/settings');

    // Positive control: the same listener still serves the workspace binding,
    // so the silence above is the projectId gate, not a dead hook.
    await userEvent.keyboard('gh');
    expect(nav.url()).toBe('/');
  });

  it('G P opens the project switcher when a project id matched', async () => {
    const nav = renderAt('/projects/p1', 'p1');

    await userEvent.keyboard('gp');

    expect(nav.onOpenProjectSwitcher).toHaveBeenCalledTimes(1);
  });

  it('G P is not bound without a project id', async () => {
    const nav = renderAt('/', null);

    await userEvent.keyboard('gp');
    expect(nav.onOpenProjectSwitcher).not.toHaveBeenCalled();

    await userEvent.keyboard(`{${MOD}>}b{/${MOD}}`);
    expect(nav.onToggleSidebar).toHaveBeenCalledTimes(1);
  });
});
