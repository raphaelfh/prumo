import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {ResizablePanel} from './resizable-panel';
import {TooltipProvider} from './tooltip';

const STORAGE_KEY = 'prumo:test-panel:width';

describe('ResizablePanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders children with default width', () => {
    render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right">
        <div data-testid="content">child</div>
      </ResizablePanel>,
    );
    const aside = screen.getByTestId('content').parentElement!;
    expect(aside.style.width).toBe('280px');
  });

  it('reads persisted width from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, '320');
    render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right">
        <div data-testid="content">child</div>
      </ResizablePanel>,
    );
    const aside = screen.getByTestId('content').parentElement!;
    expect(aside.style.width).toBe('320px');
  });

  it('falls back to default when stored value is invalid', () => {
    localStorage.setItem(STORAGE_KEY, 'garbage');
    render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right">
        <div data-testid="content">child</div>
      </ResizablePanel>,
    );
    const aside = screen.getByTestId('content').parentElement!;
    expect(aside.style.width).toBe('280px');
  });

  it('clamps width within min and max during drag', () => {
    render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right">
        <div data-testid="content">child</div>
      </ResizablePanel>,
    );
    const handle = screen.getByRole('separator');

    act(() => {
      fireEvent.mouseDown(handle, {clientX: 280});
    });
    act(() => {
      fireEvent.mouseMove(document, {clientX: 1000});
    });
    act(() => {
      fireEvent.mouseUp(document, {clientX: 1000});
    });

    const aside = screen.getByTestId('content').parentElement!;
    expect(aside.style.width).toBe('400px');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('400');
  });

  it('calls onCollapse when released below snap threshold', () => {
    const onCollapse = vi.fn();
    render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right" onCollapse={onCollapse}>
        <div data-testid="content">child</div>
      </ResizablePanel>,
    );
    const handle = screen.getByRole('separator');

    act(() => {
      fireEvent.mouseDown(handle, {clientX: 280});
    });
    act(() => {
      fireEvent.mouseMove(document, {clientX: 100});
    });
    act(() => {
      fireEvent.mouseUp(document, {clientX: 100});
    });

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('toggles collapse on handle click without drag', () => {
    const onCollapse = vi.fn();
    render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right" onCollapse={onCollapse}>
        <div data-testid="content">child</div>
      </ResizablePanel>,
    );
    const handle = screen.getByRole('separator');

    act(() => {
      fireEvent.mouseDown(handle, {clientX: 280});
    });
    act(() => {
      fireEvent.mouseUp(document, {clientX: 280});
    });

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('returns null when collapsed', () => {
    const {container} = render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right" collapsed>
        <div data-testid="content">child</div>
      </ResizablePanel>,
    );
    expect(container.querySelector('aside')).toBeNull();
  });

  it('exposes ARIA separator attributes', () => {
    render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right">
        <div data-testid="content">child</div>
      </ResizablePanel>,
    );
    const handle = screen.getByRole('separator');
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('aria-valuemin', '240');
    expect(handle).toHaveAttribute('aria-valuemax', '400');
    expect(handle).toHaveAttribute('aria-valuenow', '280');
  });

  it('animates in on expand: mounts at width 0 then widens (no instant pop)', () => {
    let rafCb: FrameRequestCallback | null = null;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCb = cb;
      return 1;
    });

    const props = {
      id: 'test-panel',
      defaultWidth: 280,
      minWidth: 240,
      maxWidth: 400,
      snapCollapseAt: 200,
      side: 'right' as const,
    };
    const {container, rerender} = render(
      <ResizablePanel {...props} collapsed>
        <div>content</div>
      </ResizablePanel>,
    );
    expect(container.querySelector('aside')).toBeNull();

    rerender(
      <ResizablePanel {...props} collapsed={false}>
        <div>content</div>
      </ResizablePanel>,
    );
    const aside = container.querySelector('aside') as HTMLElement;
    expect(aside).toBeTruthy();
    expect(aside.style.width).toBe('0px');

    act(() => {
      rafCb?.(0);
    });
    expect(aside.style.width).toBe('280px');
  });

  it('keeps inner content at a fixed width so it does not squish during the slide', () => {
    const {container} = render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right">
        <div>content</div>
      </ResizablePanel>,
    );
    const inner = container.querySelector('[data-resizable-content]') as HTMLElement;
    expect(inner).toBeTruthy();
    expect(inner.style.width).toBe('280px');
  });

  it('is width-led: the panel itself does not fade (opacity lives on the content)', () => {
    const {container} = render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right">
        <div>content</div>
      </ResizablePanel>,
    );
    const aside = container.querySelector('aside') as HTMLElement;
    expect(aside.className).not.toContain('opacity');
    expect(aside.style.opacity).toBe('');
  });

  it('does not set a native title on the drag handle (uses the shared tooltip)', () => {
    render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right">
        <div>content</div>
      </ResizablePanel>,
    );
    expect(screen.getByRole('separator')).not.toHaveAttribute('title');
  });

  it('renders the handle as a tooltip trigger when a label is provided', () => {
    render(
      <TooltipProvider>
        <ResizablePanel
          id="test-panel"
          defaultWidth={280}
          minWidth={240}
          maxWidth={400}
          snapCollapseAt={200}
          side="right"
          tooltipLabel="Collapse"
          shortcut={['mod', 'B']}
        >
          <div>content</div>
        </ResizablePanel>
      </TooltipProvider>,
    );
    const handle = screen.getByRole('separator');
    expect(handle).toBeInTheDocument();
    expect(handle).not.toHaveAttribute('title');
  });
});
