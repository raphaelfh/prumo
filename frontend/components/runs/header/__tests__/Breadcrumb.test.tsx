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
          <RunHeader.Breadcrumb
            onBack={onBack}
            crumbs={[{ label: 'Projects' }, { label: 'My Run' }]}
          />
        </RunHeader.Left>
      </RunHeader>,
    );
    const backBtn = screen.getByRole('button', { name: 'back' });
    expect(backBtn).toBeInTheDocument();
    await userEvent.click(backBtn);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('renders all crumb labels', () => {
    render(
      <RunHeader value={base}>
        <RunHeader.Left>
          <RunHeader.Breadcrumb
            onBack={vi.fn()}
            crumbs={[{ label: 'Projects' }, { label: 'Alpha Study' }, { label: 'My Run' }]}
          />
        </RunHeader.Left>
      </RunHeader>,
    );
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Alpha Study')).toBeInTheDocument();
    expect(screen.getByText('My Run')).toBeInTheDocument();
  });

  it('truncates every crumb so a non-final crumb cannot overflow into the next', () => {
    // Non-final crumbs must also truncate (min-w-0 + truncate): a whitespace-nowrap
    // crumb overflows its shrunk <li> at narrow widths and paints over the next
    // crumb. Both the final title and the non-final crumbs carry the truncate class.
    render(
      <RunHeader value={base}>
        <RunHeader.Left>
          <RunHeader.Breadcrumb
            onBack={vi.fn()}
            crumbs={[{ label: 'Projects' }, { label: 'My Run' }]}
          />
        </RunHeader.Left>
      </RunHeader>,
    );
    expect(screen.getByText('My Run').className).toMatch(/truncate/);
    expect(screen.getByText('Projects').className).toMatch(/truncate/);
  });

  it('renders clickable crumbs as buttons and non-clickable as spans', async () => {
    const onClick = vi.fn();
    render(
      <RunHeader value={base}>
        <RunHeader.Left>
          <RunHeader.Breadcrumb
            onBack={vi.fn()}
            crumbs={[{ label: 'Projects', onClick }, { label: 'My Run' }]}
          />
        </RunHeader.Left>
      </RunHeader>,
    );
    const projectsBtn = screen.getByRole('button', { name: 'Projects' });
    expect(projectsBtn).toBeInTheDocument();
    await userEvent.click(projectsBtn);
    expect(onClick).toHaveBeenCalledOnce();
    // last crumb has no onClick → not a button
    expect(screen.queryByRole('button', { name: 'My Run' })).toBeNull();
  });

  it('renders a long last-crumb title verbatim (wrapped for truncation)', () => {
    render(
      <RunHeader value={base}>
        <RunHeader.Left>
          <RunHeader.Breadcrumb
            onBack={vi.fn()}
            crumbs={[{ label: 'Projects' }, { label: 'A very long article title that should truncate' }]}
          />
        </RunHeader.Left>
      </RunHeader>,
    );
    const last = screen.getByText('A very long article title that should truncate');
    expect(last).toBeInTheDocument();
    expect(last.className).toMatch(/truncate/);
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
