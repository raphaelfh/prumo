import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunHeader } from '@/components/runs/header';
import { makeRunHeaderValue } from './_headerTestUtils';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const base = makeRunHeaderValue();

describe('RunHeader.SidebarToggle', () => {
  it('renders nothing without onToggle', () => {
    const { container } = render(
      <RunHeader value={base}><RunHeader.Left><RunHeader.SidebarToggle /></RunHeader.Left></RunHeader>,
    );
    expect(container.querySelector('button')).toBeNull();
  });
  it('toggles, exposes aria-pressed and mod+B', async () => {
    const onToggle = vi.fn();
    render(
      <RunHeader value={base}><RunHeader.Left><RunHeader.SidebarToggle pressed onToggle={onToggle} /></RunHeader.Left></RunHeader>,
    );
    const btn = screen.getByRole('button', { name: 'sidebarToggle' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    // jsdom's userAgent is not a Mac, so `mod` spells as Control — the key
    // useKeyboardShortcuts actually binds on that platform.
    expect(btn).toHaveAttribute('aria-keyshortcuts', 'Control+B');
    await userEvent.click(btn);
    expect(onToggle).toHaveBeenCalledOnce();
  });
  it('is gated to lg+ (the desktop sidebar is display:none below lg, so its collapse toggle would be a no-op there)', () => {
    render(
      <RunHeader value={base}><RunHeader.Left><RunHeader.SidebarToggle pressed onToggle={() => {}} /></RunHeader.Left></RunHeader>,
    );
    const btn = screen.getByRole('button', { name: 'sidebarToggle' });
    expect(btn.className).toContain('hidden');
    expect(btn.className).toContain('lg:inline-flex');
  });
});

describe('RunHeader.MobileNav', () => {
  it('renders nothing without onOpen', () => {
    const { container } = render(
      <RunHeader value={base}><RunHeader.Left><RunHeader.MobileNav /></RunHeader.Left></RunHeader>,
    );
    expect(container.querySelector('button')).toBeNull();
  });
  it('is a hamburger gated to below lg that opens the drawer', async () => {
    const onOpen = vi.fn();
    render(
      <RunHeader value={base}><RunHeader.Left><RunHeader.MobileNav onOpen={onOpen} /></RunHeader.Left></RunHeader>,
    );
    const btn = screen.getByRole('button', { name: 'ariaOpenMenu' });
    expect(btn.className).toContain('lg:hidden');
    await userEvent.click(btn);
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe('RunHeader.PanelToggle (mirror)', () => {
  it('exposes aria-pressed and the mod+Shift+B shortcut', async () => {
    const onToggle = vi.fn();
    render(
      <RunHeader value={base}><RunHeader.Right><RunHeader.PanelToggle pressed={false} onToggle={onToggle} /></RunHeader.Right></RunHeader>,
    );
    const btn = screen.getByRole('button', { name: 'togglePanel' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    // jsdom is not macOS, so `mod` announces as Control.
    expect(btn).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+B');
    await userEvent.click(btn);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('binds mod+Shift+B, even from inside a field', async () => {
    const onToggle = vi.fn();
    render(
      <>
        <input aria-label="field" />
        <RunHeader value={base}><RunHeader.Right><RunHeader.PanelToggle pressed={false} onToggle={onToggle} /></RunHeader.Right></RunHeader>
      </>,
    );
    screen.getByLabelText('field').focus();
    await userEvent.keyboard('{Control>}{Shift>}b{/Shift}{/Control}');
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('leaves mod+Shift+B to an open dialog', async () => {
    const onToggle = vi.fn();
    render(
      <>
        <div role="dialog" data-state="open" />
        <RunHeader value={base}><RunHeader.Right><RunHeader.PanelToggle pressed={false} onToggle={onToggle} /></RunHeader.Right></RunHeader>
      </>,
    );
    await userEvent.keyboard('{Control>}{Shift>}b{/Shift}{/Control}');
    expect(onToggle).not.toHaveBeenCalled();
  });
});
