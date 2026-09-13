import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {TooltipProvider} from '@/components/ui/tooltip';

import {FilterButtonWithPopover} from './FilterButtonWithPopover';

function renderButton(activeCount: number) {
  return render(
    <TooltipProvider delayDuration={0}>
      <FilterButtonWithPopover open={false} onOpenChange={vi.fn()} activeCount={activeCount} label="Filter">
        <div>panel</div>
      </FilterButtonWithPopover>
    </TooltipProvider>,
  );
}

describe('FilterButtonWithPopover', () => {
  it('names itself, announces the F shortcut and shows it as a chip', async () => {
    renderButton(0);
    const button = screen.getByRole('button', {name: 'Filter'});
    expect(button).toHaveAttribute('aria-keyshortcuts', 'F');
    await userEvent.hover(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Filter');
    expect(document.querySelector('kbd')).toHaveTextContent('F');
  });

  it('shows the active filter count on the button', () => {
    renderButton(2);
    expect(screen.getByRole('button', {name: 'Filter'})).toHaveTextContent('2');
  });
});
