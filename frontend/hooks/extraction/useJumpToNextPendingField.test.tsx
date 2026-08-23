import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useJumpToNextPendingField } from './useJumpToNextPendingField';

/** Minimal stand-in for the form: three rows, the middle one already answered. */
function Harness({ pending }: { pending: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const jump = useJumpToNextPendingField(ref);
  return (
    <>
      <button type="button" onClick={jump}>
        jump
      </button>
      <div ref={ref}>
        {['a', 'b', 'c'].map((id) => (
          <div key={id} data-pending-required={pending.includes(id) || undefined}>
            <input aria-label={id} />
          </div>
        ))}
      </div>
    </>
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('useJumpToNextPendingField', () => {
  it('focuses the first pending field, skipping answered ones', async () => {
    render(<Harness pending={['b', 'c']} />);
    await userEvent.click(screen.getByRole('button', { name: 'jump' }));
    expect(screen.getByLabelText('b')).toHaveFocus();
  });

  it('advances on each click instead of re-focusing the same field', async () => {
    render(<Harness pending={['a', 'b', 'c']} />);
    const jump = screen.getByRole('button', { name: 'jump' });
    await userEvent.click(jump);
    expect(screen.getByLabelText('a')).toHaveFocus();
    await userEvent.click(jump);
    expect(screen.getByLabelText('b')).toHaveFocus();
  });

  it('wraps around after the last pending field', async () => {
    render(<Harness pending={['a', 'c']} />);
    const jump = screen.getByRole('button', { name: 'jump' });
    await userEvent.click(jump); // a
    await userEvent.click(jump); // c
    expect(screen.getByLabelText('c')).toHaveFocus();
    await userEvent.click(jump); // wraps
    expect(screen.getByLabelText('a')).toHaveFocus();
  });

  it('scrolls the target into view', async () => {
    render(<Harness pending={['b']} />);
    await userEvent.click(screen.getByRole('button', { name: 'jump' }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('does nothing when no field is pending', async () => {
    render(<Harness pending={[]} />);
    await userEvent.click(screen.getByRole('button', { name: 'jump' }));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
