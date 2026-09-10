/**
 * PanelToggleButton is shared by the Topbar sidebar toggle, the run screens'
 * header toggles, and the articles panel — a `side` regression here breaks
 * three unrelated screens at once. This spec pins the glyph pair per `side`
 * (including the `'bottom'` case the stacked, below-lg articles layout needs),
 * the pressed/label contract, and the opt-in shortcut hint.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PanelToggleButton } from './PanelToggleButton';

function svgClassesOf(container: HTMLElement) {
  return Array.from(container.querySelectorAll('svg')).map((svg) => svg.getAttribute('class') ?? '');
}

describe('PanelToggleButton', () => {
  it('shows the left-panel glyph pair for side="left"', () => {
    const { container } = render(
      <PanelToggleButton side="left" pressed={false} onToggle={vi.fn()} ariaLabel="Toggle sidebar" />,
    );

    const classes = svgClassesOf(container);
    expect(classes.some((c) => c.includes('lucide-panel-left-close'))).toBe(true);
    expect(classes.some((c) => c.includes('lucide-panel-left-open'))).toBe(true);
  });

  it('shows the right-panel glyph pair for side="right"', () => {
    const { container } = render(
      <PanelToggleButton side="right" pressed={false} onToggle={vi.fn()} ariaLabel="Toggle panel" />,
    );

    const classes = svgClassesOf(container);
    expect(classes.some((c) => c.includes('lucide-panel-right-close'))).toBe(true);
    expect(classes.some((c) => c.includes('lucide-panel-right-open'))).toBe(true);
  });

  it('shows the bottom-panel glyph pair for side="bottom" — the stacked layout opens the panel from the bottom', () => {
    const { container } = render(
      <PanelToggleButton side="bottom" pressed={false} onToggle={vi.fn()} ariaLabel="Toggle panel" />,
    );

    const classes = svgClassesOf(container);
    expect(classes.some((c) => c.includes('lucide-panel-bottom-close'))).toBe(true);
    expect(classes.some((c) => c.includes('lucide-panel-bottom-open'))).toBe(true);
    // Never falls back to the left/right glyphs for the new side.
    expect(classes.some((c) => c.includes('lucide-panel-left'))).toBe(false);
    expect(classes.some((c) => c.includes('lucide-panel-right'))).toBe(false);
  });

  it('keeps the caller-supplied aria-label regardless of side', () => {
    render(
      <PanelToggleButton side="bottom" pressed onToggle={vi.fn()} ariaLabel="Hide the article panel" />,
    );

    expect(screen.getByRole('button', { name: 'Hide the article panel' })).toBeInTheDocument();
  });

  it('reflects pressed state and fires onToggle', () => {
    const onToggle = vi.fn();
    render(<PanelToggleButton side="left" pressed onToggle={onToggle} ariaLabel="Toggle nav" />);

    const btn = screen.getByRole('button', { name: 'Toggle nav' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  // aria-keyshortcuts is announced by screen readers, so advertising a key the
  // screen does not bind is worse than advertising none. It used to be derived
  // from `side`, which handed every non-left caller '\' — a key bound only by
  // `useRunShortcuts`, so the articles panel toggles promised nothing real.
  it('advertises no shortcut unless the caller opts in', () => {
    render(<PanelToggleButton side="right" pressed={false} onToggle={vi.fn()} ariaLabel="Toggle panel" />);

    expect(screen.getByRole('button', { name: 'Toggle panel' })).not.toHaveAttribute('aria-keyshortcuts');
  });

  it('passes through the shortcut a caller does bind', () => {
    render(
      <PanelToggleButton
        side="right"
        pressed={false}
        onToggle={vi.fn()}
        ariaLabel="Toggle panel"
        keyShortcuts={'\\'}
      />,
    );

    expect(screen.getByRole('button', { name: 'Toggle panel' })).toHaveAttribute('aria-keyshortcuts', '\\');
  });
});
