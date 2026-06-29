import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { AIPopoverShell } from './AIPopoverShell';

describe('AIPopoverShell', () => {
  it('renders a solid, responsive shell with header + body', () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>open</PopoverTrigger>
        <AIPopoverShell icon={<span>i</span>} title="Suggestion details" count="3 found">
          <p>body content</p>
        </AIPopoverShell>
      </Popover>,
    );
    const popover = document.querySelector('.bg-popover') as HTMLElement;
    expect(popover).not.toBeNull();
    expect(popover.className).toContain('w-[min(380px,calc(100vw-1.5rem))]');
    expect(popover.textContent).toContain('Suggestion details');
    expect(popover.textContent).toContain('3 found');
    expect(popover.textContent).toContain('body content');
  });
});
