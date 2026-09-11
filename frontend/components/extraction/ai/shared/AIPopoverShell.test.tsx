import { render, screen } from '@testing-library/react';
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
    expect(popover.className).toContain('w-[min(420px,calc(100vw-1.5rem))]');
    expect(popover.textContent).toContain('Suggestion details');
    expect(popover.textContent).toContain('3 found');
    expect(popover.textContent).toContain('body content');
  });

  it('keeps the header to one line: the count sits beside the title', () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>open</PopoverTrigger>
        <AIPopoverShell icon={<span>i</span>} title="Review suggestion" count="1 version">
          <p>body</p>
        </AIPopoverShell>
      </Popover>,
    );
    const title = screen.getByText('Review suggestion');
    const count = screen.getByText('1 version');
    expect(count.parentElement).toBe(title.parentElement);
    // A row, not a stacked title-over-count block.
    expect(title.parentElement).toHaveClass('flex');
  });

  it('bounds the popover to the viewport with a single scroll region', () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>open</PopoverTrigger>
        <AIPopoverShell icon={<span>i</span>} title="Review">
          <div data-testid="body">body content</div>
        </AIPopoverShell>
      </Popover>,
    );
    const popover = document.querySelector('.bg-popover') as HTMLElement;
    // Height is bounded by the space Radix reports below/above the trigger, so
    // the popover can never grow past the viewport and get clipped — and it is
    // a share of the viewport, not a fixed cap, so a tall screen shows more.
    expect(popover.className).toContain(
      'max-h-[min(var(--radix-popover-content-available-height),70vh)]',
    );
    expect(popover.className).toContain('flex-col');
    // The body is the ONLY scroll region and absorbs content growth.
    const body = document.querySelector('[data-testid="body"]') as HTMLElement;
    const scroll = body.parentElement as HTMLElement;
    expect(scroll.className).toContain('overflow-y-auto');
    expect(scroll.className).toContain('min-h-0');
    expect(scroll.className).toContain('flex-1');
  });

  it('renders a pinned footer OUTSIDE the scrollable body', () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>open</PopoverTrigger>
        <AIPopoverShell
          icon={<span>i</span>}
          title="Review"
          footer={<div data-testid="ftr">Clear</div>}
        >
          <div data-testid="body">body</div>
        </AIPopoverShell>
      </Popover>,
    );
    const ftr = document.querySelector('[data-testid="ftr"]') as HTMLElement;
    const scroll = (
      document.querySelector('[data-testid="body"]') as HTMLElement
    ).closest('.overflow-y-auto');
    expect(ftr).not.toBeNull();
    expect(scroll).not.toBeNull();
    // footer is pinned (not inside the scroll region) so it stays reachable
    // no matter how long the body list grows.
    expect(scroll?.contains(ftr)).toBe(false);
  });
});
