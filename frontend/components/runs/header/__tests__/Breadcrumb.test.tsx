// frontend/components/runs/header/__tests__/Breadcrumb.test.tsx
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

  it('applies truncate class to the last crumb only', () => {
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
    const lastCrumb = screen.getByText('My Run');
    expect(lastCrumb.className).toMatch(/truncate/);
    const firstCrumb = screen.getByText('Projects');
    expect(firstCrumb.className).not.toMatch(/truncate/);
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
    const trigger = screen.getByRole('button', { name: 'runHeaderMore' });
    expect(trigger).toBeInTheDocument();
    await userEvent.click(trigger);
    const item = screen.getByRole('menuitem', { name: 'Delete run' });
    await userEvent.click(item);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
