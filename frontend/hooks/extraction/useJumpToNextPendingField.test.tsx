import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useJumpToNextPendingField } from './useJumpToNextPendingField';

/** A stand-in for the form: a jump button, and sections it can open. */
function Harness({
  pendingSectionIds = [],
  children,
}: {
  pendingSectionIds?: string[];
  children: (openIds: Set<string>) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [openIds, setOpenIds] = useState(() => new Set<string>());
  const jump = useJumpToNextPendingField(ref, {
    pendingIds: new Set(pendingSectionIds),
    open: (id) => setOpenIds((prev) => new Set(prev).add(id)),
  });
  return (
    <>
      <button type="button" onClick={jump}>
        jump
      </button>
      <div ref={ref}>{children(openIds)}</div>
    </>
  );
}

function Row({ id, pending }: { id: string; pending: boolean }) {
  return (
    <div data-pending-required={pending || undefined}>
      <input aria-label={id} />
    </div>
  );
}

/** Renders its rows only while open, as Radix's AccordionContent does. */
function Section({ id, open, children }: { id: string; open: boolean; children: ReactNode }) {
  return <div data-section-id={id}>{open && children}</div>;
}

const rows = (pending: string[]) => () =>
  ['a', 'b', 'c'].map((id) => <Row key={id} id={id} pending={pending.includes(id)} />);

const jumpButton = () => screen.getByRole('button', { name: 'jump' });

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('useJumpToNextPendingField', () => {
  it('focuses the first pending field, skipping answered ones', async () => {
    render(<Harness>{rows(['b', 'c'])}</Harness>);
    await userEvent.click(jumpButton());
    expect(screen.getByLabelText('b')).toHaveFocus();
  });

  it('advances on each click instead of re-focusing the same field', async () => {
    render(<Harness>{rows(['a', 'b', 'c'])}</Harness>);
    await userEvent.click(jumpButton());
    expect(screen.getByLabelText('a')).toHaveFocus();
    await userEvent.click(jumpButton());
    expect(screen.getByLabelText('b')).toHaveFocus();
  });

  it('wraps around after the last pending field', async () => {
    render(<Harness>{rows(['a', 'c'])}</Harness>);
    await userEvent.click(jumpButton()); // a
    await userEvent.click(jumpButton()); // c
    expect(screen.getByLabelText('c')).toHaveFocus();
    await userEvent.click(jumpButton()); // wraps
    expect(screen.getByLabelText('a')).toHaveFocus();
  });

  it('scrolls the target into view', async () => {
    render(<Harness>{rows(['b'])}</Harness>);
    await userEvent.click(jumpButton());
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('does nothing when no field is pending', async () => {
    render(<Harness>{rows([])}</Harness>);
    await userEvent.click(jumpButton());
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('useJumpToNextPendingField — closed sections', () => {
  it('opens a closed section that still needs answers and focuses its first pending field', async () => {
    render(
      <Harness pendingSectionIds={['s']}>
        {(open) => (
          <Section id="s" open={open.has('s')}>
            <Row id="inside" pending />
          </Section>
        )}
      </Harness>,
    );
    await userEvent.click(jumpButton());
    expect(screen.getByLabelText('inside')).toHaveFocus();
  });

  it('never opens a section with nothing left to answer', async () => {
    render(
      <Harness>
        {(open) => (
          <>
            <Section id="done" open={open.has('done')}>
              <Row id="answered" pending={false} />
            </Section>
            <Row id="next" pending />
          </>
        )}
      </Harness>,
    );
    await userEvent.click(jumpButton());
    expect(screen.getByLabelText('next')).toHaveFocus();
    expect(screen.queryByLabelText('answered')).not.toBeInTheDocument();
  });

  it('walks an open field before a later closed section, in document order', async () => {
    render(
      <Harness pendingSectionIds={['later']}>
        {(open) => (
          <>
            <Row id="first" pending />
            <Section id="later" open={open.has('later')}>
              <Row id="second" pending />
            </Section>
          </>
        )}
      </Harness>,
    );
    await userEvent.click(jumpButton());
    expect(screen.getByLabelText('first')).toHaveFocus();
    await userEvent.click(jumpButton());
    expect(screen.getByLabelText('second')).toHaveFocus();
  });

  it('moves past a section that opens with no pending row inside', async () => {
    render(
      <Harness pendingSectionIds={['empty']}>
        {(open) => (
          <>
            <Section id="empty" open={open.has('empty')}>
              <Row id="unstamped" pending={false} />
            </Section>
            <Row id="next" pending />
          </>
        )}
      </Harness>,
    );
    await userEvent.click(jumpButton()); // opens "empty", nothing to land on
    expect(screen.getByLabelText('unstamped')).toBeInTheDocument();
    await userEvent.click(jumpButton());
    expect(screen.getByLabelText('next')).toHaveFocus();
  });
});
