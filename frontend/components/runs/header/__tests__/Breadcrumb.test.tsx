// frontend/components/runs/header/__tests__/Breadcrumb.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunHeader } from '@/components/runs/header';
import { makeRunHeaderValue } from './_headerTestUtils';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const base = makeRunHeaderValue();

describe('RunHeader.Breadcrumb', () => {
  it('renders back button and calls onBack when clicked', async () => {
    const onBack = vi.fn();
    render(
      <RunHeader value={base}>
        <RunHeader.Left>
          <RunHeader.Breadcrumb onBack={onBack} title="My Run" />
        </RunHeader.Left>
      </RunHeader>,
    );
    const backBtn = screen.getByRole('button', { name: 'back' });
    expect(backBtn).toBeInTheDocument();
    await userEvent.click(backBtn);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('renders only the title — no crumb list, no project crumb', () => {
    render(
      <RunHeader value={base}>
        <RunHeader.Left>
          <RunHeader.Breadcrumb onBack={vi.fn()} title="My Run" />
        </RunHeader.Left>
      </RunHeader>,
    );
    expect(screen.getByText('My Run')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('renders a long title verbatim, wrapped for truncation', () => {
    render(
      <RunHeader value={base}>
        <RunHeader.Left>
          <RunHeader.Breadcrumb onBack={vi.fn()} title="A very long article title that should truncate" />
        </RunHeader.Left>
      </RunHeader>,
    );
    const title = screen.getByText('A very long article title that should truncate');
    expect(title).toBeInTheDocument();
    expect(title.className).toMatch(/truncate/);
  });
});

describe('RunHeader.Menu + RunHeader.MenuItem', () => {
  it('opens menu on trigger click and fires onSelect when a MenuItem is clicked', async () => {
    const onSelect = vi.fn();
    render(
      <RunHeader value={base}>
        <RunHeader.Right>
          <RunHeader.Menu>
            <RunHeader.MenuItem onSelect={onSelect}>Delete run</RunHeader.MenuItem>
          </RunHeader.Menu>
        </RunHeader.Right>
      </RunHeader>,
    );
    const trigger = screen.getByRole('button', { name: 'more' });
    expect(trigger).toBeInTheDocument();
    await userEvent.click(trigger);
    const item = screen.getByRole('menuitem', { name: 'Delete run' });
    await userEvent.click(item);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
