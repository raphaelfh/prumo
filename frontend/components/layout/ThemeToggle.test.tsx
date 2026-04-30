import {describe, it, expect, beforeEach} from 'vitest';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {ThemeProvider} from 'next-themes';
import {ThemeToggle} from './ThemeToggle';

function renderWithTheme(initial: 'light' | 'dark' | 'system') {
  return render(
    <ThemeProvider attribute="class" defaultTheme={initial} enableSystem storageKey="prumo:theme">
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('cycles light → dark → system → light', async () => {
    const user = userEvent.setup();
    renderWithTheme('light');
    const button = screen.getByRole('button', {name: /toggle theme/i});

    await user.click(button);
    expect(localStorage.getItem('prumo:theme')).toBe('dark');

    await user.click(button);
    expect(localStorage.getItem('prumo:theme')).toBe('system');

    await user.click(button);
    expect(localStorage.getItem('prumo:theme')).toBe('light');
  });
});
