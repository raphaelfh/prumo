import {describe, it, expect, beforeEach} from 'vitest';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {ThemeProvider} from '@/contexts/ThemeContext';
import {ThemeToggle} from './ThemeToggle';

function renderWithTheme(initial: 'light' | 'dark' | 'system') {
  localStorage.setItem('prumo:theme', initial);
  return render(
    <ThemeProvider>
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
