import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { SectionNavLayout, type SectionNavHandle } from './SectionNavLayout';
import { RunEditabilityProvider } from './RunEditabilityContext';
import { useSectionOpen } from './SectionOpenContext';
import type { SectionNavItem } from '@/lib/extraction/sectionRegistry';

const items: SectionNavItem[] = [
  { id: 's1', label: 'Source of data', requiredTotal: 2, requiredFilled: 1, state: 'in_progress', level: 0 },
];

function Layout() {
  return (
    <SectionNavLayout items={items} activeId="s1" onSelect={vi.fn()}>
      <div data-pending-required="">
        <input aria-label="pending" />
      </div>
      <input aria-label="answered" />
    </SectionNavLayout>
  );
}

/** A section accordion in miniature: closed by default, rows mounted only while open. */
function Section({ id, pending }: { id: string; pending: boolean }) {
  const [open] = useSectionOpen(id, false);
  return (
    <div data-section-id={id}>
      {open && (
        <div data-pending-required={pending || undefined}>
          <input aria-label={`${id} field`} />
        </div>
      )}
    </div>
  );
}

const rail = () => screen.queryByRole('navigation', { name: 'sectionNavAria' });

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('SectionNavLayout', () => {
  it('shows the section rail by default, with a toggle that says it hides it', () => {
    render(<Layout />);
    expect(rail()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'sectionNavHide' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('hides the rail entirely — no strip left behind — and remembers the choice', async () => {
    const { unmount } = render(<Layout />);
    await userEvent.click(screen.getByRole('button', { name: 'sectionNavHide' }));
    expect(rail()).not.toBeInTheDocument();
    expect(screen.queryByText('Source of data')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'sectionNavShow' })).toHaveAttribute('aria-expanded', 'false');

    unmount();
    render(<Layout />);
    expect(rail()).not.toBeInTheDocument();
  });

  it('mod+\\ toggles the rail', async () => {
    render(<Layout />);
    await userEvent.keyboard('{Control>}\\{/Control}');
    expect(rail()).not.toBeInTheDocument();
    await userEvent.keyboard('{Control>}\\{/Control}');
    expect(rail()).toBeInTheDocument();
  });

  it('mod+Enter jumps to the next required field, even from inside a field', async () => {
    render(<Layout />);
    screen.getByLabelText('answered').focus();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(screen.getByLabelText('pending')).toHaveFocus());
  });

  it('mod+Enter does nothing on a read-only run', async () => {
    render(
      <RunEditabilityProvider stage="finalized">
        <Layout />
      </RunEditabilityProvider>,
    );
    screen.getByLabelText('answered').focus();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(screen.getByLabelText('answered')).toHaveFocus();
  });
});

describe('SectionNavLayout — section open state', () => {
  const sections: SectionNavItem[] = [
    { id: 'done', label: 'Complete section', requiredTotal: 1, requiredFilled: 1, state: 'complete', level: 0 },
    { id: 'todo', label: 'Pending section', requiredTotal: 2, requiredFilled: 0, state: 'empty', level: 0 },
  ];

  it('mod+Enter opens the next closed section that still needs answers, leaving complete ones closed', async () => {
    render(
      <SectionNavLayout items={sections} activeId={null} onSelect={vi.fn()}>
        <Section id="done" pending={false} />
        <Section id="todo" pending />
      </SectionNavLayout>,
    );
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(screen.getByLabelText('todo field')).toHaveFocus();
    expect(screen.queryByLabelText('done field')).not.toBeInTheDocument();
  });

  it('picking a section in the rail opens it', async () => {
    const onSelect = vi.fn();
    render(
      <SectionNavLayout items={sections} activeId={null} onSelect={onSelect}>
        <Section id="done" pending={false} />
      </SectionNavLayout>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Complete section/ }));
    expect(onSelect).toHaveBeenCalledWith('done');
    expect(screen.getByLabelText('done field')).toBeInTheDocument();
  });

  it('revealSection opens a closed section and selects it, for a caller outside the layout', () => {
    const onSelect = vi.fn();
    const nav = createRef<SectionNavHandle>();
    render(
      <SectionNavLayout ref={nav} items={sections} activeId={null} onSelect={onSelect}>
        <Section id="todo" pending />
      </SectionNavLayout>,
    );
    expect(screen.queryByLabelText('todo field')).not.toBeInTheDocument();
    expect(nav.current).not.toBeNull();

    act(() => nav.current?.revealSection('todo'));

    expect(onSelect).toHaveBeenCalledWith('todo');
    expect(screen.getByLabelText('todo field')).toBeInTheDocument();
  });
});
