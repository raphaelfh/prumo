import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';

import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from './tooltip';

function Tip() {
  return (
    <Tooltip>
      <TooltipTrigger>trigger</TooltipTrigger>
      <TooltipContent>Add author</TooltipContent>
    </Tooltip>
  );
}

describe('Tooltip', () => {
  it('renders without an app-level provider (a component rendered alone in a test)', async () => {
    render(<Tip />);
    await userEvent.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Add author');
  });

  it('defers to the mounted provider instead of nesting its own', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tip />
      </TooltipProvider>,
    );
    await userEvent.hover(screen.getByText('trigger'));
    // Synchronous: a nested fallback provider would impose the 400 ms default.
    expect(screen.getByRole('tooltip')).toHaveTextContent('Add author');
  });

  it('defaults the provider to a 400 ms first delay', async () => {
    render(
      <TooltipProvider>
        <Tip />
      </TooltipProvider>,
    );
    await userEvent.hover(screen.getByText('trigger'));
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Add author');
  });

  it('draws an inverted pill with no border and a plain fade', async () => {
    render(<Tip />);
    await userEvent.tab();
    const content = await screen.findByRole('tooltip');
    const classes = content.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['bg-foreground', 'text-background', 'motion-reduce:animate-none']));
    expect(classes).not.toContain('border');
    expect(classes.some((c) => c.includes('zoom-') || c.includes('slide-in'))).toBe(false);
  });
});
