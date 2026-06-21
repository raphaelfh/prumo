import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelToggleButton } from './PanelToggleButton';

describe('PanelToggleButton', () => {
  it('wires the left variant shortcut + pressed state and fires onToggle', () => {
    const onToggle = vi.fn();
    render(<PanelToggleButton side="left" pressed onToggle={onToggle} ariaLabel="Toggle nav" />);
    const btn = screen.getByRole('button', { name: 'Toggle nav' });
    expect(btn).toHaveAttribute('aria-keyshortcuts', 'Meta+B');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('uses the backslash shortcut for the right variant', () => {
    render(<PanelToggleButton side="right" pressed={false} onToggle={() => {}} ariaLabel="Toggle panel" />);
    expect(screen.getByRole('button', { name: 'Toggle panel' })).toHaveAttribute('aria-keyshortcuts', '\\');
  });
});
