import {describe, expect, it, vi, afterEach} from 'vitest';
import {render, screen} from '@testing-library/react';
import {KbdBadge} from './kbd-badge';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('KbdBadge', () => {
  it('renders single-key badge', () => {
    render(<KbdBadge keys={['A']} />);
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('joins keys with middle dot for sequences', () => {
    render(<KbdBadge keys={['G', 'A']} variant="sequence" />);
    expect(screen.getByText('G·A')).toBeInTheDocument();
  });

  it('renders modifier as ⌘ on mac', () => {
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Macintosh)'});
    render(<KbdBadge keys={['mod', 'B']} />);
    expect(screen.getByText('⌘B')).toBeInTheDocument();
  });

  it('renders modifier as Ctrl on non-mac', () => {
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Windows)'});
    render(<KbdBadge keys={['mod', 'B']} />);
    expect(screen.getByText('CtrlB')).toBeInTheDocument();
  });

  it('is aria-hidden by default', () => {
    const {container} = render(<KbdBadge keys={['A']} />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });
});
