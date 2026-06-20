import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '../CommandPalette';

// Mock the copy module so tests don't need the full i18n setup
vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

// Mock the command dialog components — jsdom doesn't render portal content reliably
// without the Dialog, so we mock it to render children directly.
vi.mock('@/components/ui/command', () => ({
  CommandDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? React.createElement('div', { role: 'dialog', 'data-testid': 'cmd-dialog' }, children) : null,
  CommandInput: ({ placeholder }: { placeholder?: string }) =>
    React.createElement('input', { 'aria-label': 'command-input', placeholder }),
  CommandList: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'cmd-list' }, children),
  CommandEmpty: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'cmd-empty' }, children),
  CommandGroup: ({ heading, children }: { heading?: string; children: React.ReactNode }) =>
    React.createElement(
      'div',
      { 'data-testid': 'cmd-group', 'data-heading': heading },
      children,
    ),
  CommandItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) =>
    React.createElement(
      'button',
      { 'data-testid': 'cmd-item', onClick: onSelect },
      children,
    ),
}));

describe('CommandPalette', () => {
  it('renders both action labels when open=true', () => {
    const actions = [
      { id: 'compare', label: 'Toggle compare', run: vi.fn() },
      { id: 'panel', label: 'Toggle panel', run: vi.fn() },
    ];

    render(
      <CommandPalette open={true} onOpenChange={vi.fn()} actions={actions} />,
    );

    expect(screen.getByText('Toggle compare')).toBeInTheDocument();
    expect(screen.getByText('Toggle panel')).toBeInTheDocument();
  });

  it('renders nothing when open=false', () => {
    const actions = [{ id: 'a', label: 'Action A', run: vi.fn() }];
    render(
      <CommandPalette open={false} onOpenChange={vi.fn()} actions={actions} />,
    );
    expect(screen.queryByTestId('cmd-dialog')).not.toBeInTheDocument();
  });

  it('calls action.run and onOpenChange(false) when an action is selected', async () => {
    const user = userEvent.setup();
    const runFn = vi.fn();
    const onOpenChange = vi.fn();
    const actions = [{ id: 'reopen', label: 'Reopen', run: runFn }];

    render(
      <CommandPalette open={true} onOpenChange={onOpenChange} actions={actions} />,
    );

    await user.click(screen.getByText('Reopen'));

    expect(runFn).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders a "Go to article" group when articles+onNavigate are passed', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onOpenChange = vi.fn();
    const articles = [
      { id: 'art-1', title: 'Article One' },
      { id: 'art-2', title: 'Article Two' },
    ];

    render(
      <CommandPalette
        open={true}
        onOpenChange={onOpenChange}
        actions={[]}
        articles={articles}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByText('Article One')).toBeInTheDocument();
    expect(screen.getByText('Article Two')).toBeInTheDocument();

    await user.click(screen.getByText('Article One'));

    expect(onNavigate).toHaveBeenCalledWith('art-1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
