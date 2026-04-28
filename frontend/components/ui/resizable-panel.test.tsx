import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {ResizablePanel} from './resizable-panel';

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
});
