import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunHeader } from '@/components/runs/header';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const base = {
  kind: 'extraction' as const, stage: 'review' as const, isRevision: false,
  isBlind: false, canReveal: false,
  progress: { completed: 0, total: 0, pct: 0 }, reviewers: { count: 0, required: 0, divergent: 0 }, transition: null,
};

describe('RunHeader.SidebarToggle', () => {
  it('renders nothing without onToggle', () => {
    const { container } = render(
      <RunHeader value={base}><RunHeader.Left><RunHeader.SidebarToggle /></RunHeader.Left></RunHeader>,
    );
    expect(container.querySelector('button')).toBeNull();
  });
  it('toggles, exposes aria-pressed and Meta+B', async () => {
    const onToggle = vi.fn();
    render(
      <RunHeader value={base}><RunHeader.Left><RunHeader.SidebarToggle pressed onToggle={onToggle} /></RunHeader.Left></RunHeader>,
    );
    const btn = screen.getByRole('button', { name: 'sidebarToggle' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveAttribute('aria-keyshortcuts', 'Meta+B');
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
  it('exposes aria-pressed and the backslash shortcut', async () => {
    const onToggle = vi.fn();
    render(
      <RunHeader value={base}><RunHeader.Right><RunHeader.PanelToggle pressed={false} onToggle={onToggle} /></RunHeader.Right></RunHeader>,
    );
    const btn = screen.getByRole('button', { name: 'togglePanel' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).toHaveAttribute('aria-keyshortcuts', '\\');
    await userEvent.click(btn);
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
