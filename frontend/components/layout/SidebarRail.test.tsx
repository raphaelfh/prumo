import {describe, it, expect, vi, afterEach} from 'vitest';
import {act, fireEvent, render} from '@testing-library/react';
import {SidebarRail} from './SidebarRail';

describe('SidebarRail', () => {
  afterEach(() => vi.useRealTimers());

  it('renders its content and starts collapsed (56px, data-peek=closed)', () => {
    const {container, getByText} = render(
      <SidebarRail>
        <div>Nav content</div>
      </SidebarRail>,
    );
    expect(getByText('Nav content')).toBeInTheDocument();
    const aside = container.querySelector('[data-peek]') as HTMLElement;
    expect(aside.getAttribute('data-peek')).toBe('closed');
    expect(aside.className).toContain('w-14');
    expect(aside.className).not.toContain('w-64 shadow');
  });

  it('opens immediately on keyboard focus and closes on Escape', () => {
    const {container} = render(
      <SidebarRail>
        <button>Item</button>
      </SidebarRail>,
    );
    const aside = container.querySelector('[data-peek]') as HTMLElement;
    act(() => {
      fireEvent.focus(container.querySelector('button')!);
    });
    expect(aside.getAttribute('data-peek')).toBe('open');
    expect(aside.className).toContain('w-64');

    act(() => {
      fireEvent.keyDown(aside, {key: 'Escape'});
    });
    expect(aside.getAttribute('data-peek')).toBe('closed');
  });

  it('peeks open only after the hover-in delay', () => {
    vi.useFakeTimers();
    const {container} = render(
      <SidebarRail>
        <div>Nav</div>
      </SidebarRail>,
    );
    const aside = container.querySelector('[data-peek]') as HTMLElement;
    act(() => {
      fireEvent.mouseEnter(aside);
    });
    expect(aside.getAttribute('data-peek')).toBe('closed');
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(aside.getAttribute('data-peek')).toBe('open');
  });
});
