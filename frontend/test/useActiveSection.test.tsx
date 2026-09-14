// frontend/test/useActiveSection.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { pickActiveSection, useActiveSection } from '@/hooks/extraction/useActiveSection';

/** jsdom has no layout and no frame loop: frames run when the test says so. */
function manualFrames() {
  const queue: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return { pending: () => queue.length, flush: () => act(() => queue.splice(0).forEach((cb) => cb(0))) };
}

/** An overflowing pane holding one section per entry, `top` px below the pane's top edge. */
function paneWith(tops: Record<string, number>) {
  const pane = document.createElement('div');
  pane.style.overflowY = 'auto';
  Object.defineProperty(pane, 'scrollHeight', { value: 3000 });
  Object.defineProperty(pane, 'clientHeight', { value: 600 });
  Object.defineProperty(pane, 'scrollTop', { value: 0, writable: true });
  pane.getBoundingClientRect = () => ({ top: 0, height: 600 }) as DOMRect;
  const sections = Object.entries(tops).map(([id, top]) => {
    const el = document.createElement('section');
    el.getBoundingClientRect = () => ({ top, height: 200 }) as DOMRect;
    pane.appendChild(el);
    return [id, el] as const;
  });
  document.body.appendChild(pane);
  return { pane, sections };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('pickActiveSection', () => {
  // Tops are pane-relative pixels; the activation line sits at 200.
  const form = [
    { id: 'a', top: -320 },
    { id: 'b', top: 40 },
    { id: 'c', top: 900 },
  ];

  it('picks the last section that starts at or above the activation line', () => {
    expect(pickActiveSection(form, 200, false)).toBe('b');
  });

  it('keeps the first section while the form sits below the line', () => {
    expect(pickActiveSection([{ id: 'a', top: 640 }, { id: 'b', top: 1200 }], 200, false)).toBe('a');
  });

  it('gives the last section the rail once the pane has bottomed out', () => {
    // The trailing section is short: it never reaches the line, so only the
    // at-bottom case can hand it the rail.
    expect(pickActiveSection(form, 200, true)).toBe('c');
  });

  it('a tall section no longer outvotes the one being read', () => {
    // 'b' covers most of the pane, but the reader has scrolled past its start.
    expect(pickActiveSection([{ id: 'b', top: -2000 }, { id: 'c', top: 120 }], 200, false)).toBe('c');
  });

  it('has nothing to say about an unmeasured form', () => {
    expect(pickActiveSection([], 200, false)).toBeNull();
  });
});

describe('useActiveSection', () => {
  it('scrollToSection scrolls and focuses the registered element', () => {
    const { result } = renderHook(() => useActiveSection(['s1', 's2']));
    const el = document.createElement('div');
    el.tabIndex = -1;
    const scrollIntoView = vi.fn();
    el.scrollIntoView = scrollIntoView;
    const focus = vi.spyOn(el, 'focus');
    act(() => result.current.registerSection('s1', el));
    act(() => result.current.scrollToSection('s1'));
    // No `behavior: 'smooth'`: a smooth scroll across this pane takes over a
    // second, and the spy re-picks every section it drifts past.
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(focus).toHaveBeenCalled();
  });

  it('scrolls the last section the same way as any other', () => {
    const { result } = renderHook(() => useActiveSection(['s1', 's2']));
    const el = document.createElement('div');
    const scrollIntoView = vi.fn();
    el.scrollIntoView = scrollIntoView;
    act(() => result.current.registerSection('s2', el));
    act(() => result.current.scrollToSection('s2'));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('marks the clicked section active immediately, even before any scroll settles', () => {
    const { result } = renderHook(() => useActiveSection(['s1', 's2']));
    expect(result.current.activeId).toBe('s1');
    const el = document.createElement('div');
    el.scrollIntoView = vi.fn();
    act(() => result.current.registerSection('s2', el));
    act(() => result.current.scrollToSection('s2'));
    expect(result.current.activeId).toBe('s2');
  });

  it('shades a section even when its node is not registered yet', () => {
    const { result } = renderHook(() => useActiveSection(['s1', 's2']));
    act(() => result.current.scrollToSection('s2'));
    expect(result.current.activeId).toBe('s2');
  });

  it('recomputes the active section from a pane scroll, once per frame', () => {
    const frames = manualFrames();
    const { result } = renderHook(() => useActiveSection(['s1', 's2', 's3']));
    const { pane, sections } = paneWith({ s1: -500, s2: 100, s3: 700 });
    act(() => sections.forEach(([id, el]) => result.current.registerSection(id, el)));
    pane.dispatchEvent(new Event('scroll'));
    pane.dispatchEvent(new Event('scroll'));
    expect(frames.pending()).toBe(1);
    expect(result.current.activeId).toBe('s1');
    frames.flush();
    // 's2' starts above the 120px activation line and 's3' below it.
    expect(result.current.activeId).toBe('s2');
  });

  it('holds a clicked section for two frames against the landing scroll', () => {
    const frames = manualFrames();
    const { result } = renderHook(() => useActiveSection(['s1', 's2', 's3']));
    const { pane, sections } = paneWith({ s1: -500, s2: 100, s3: 700 });
    act(() => sections.forEach(([id, el]) => result.current.registerSection(id, el)));
    act(() => result.current.scrollToSection('s3'));
    // Frame 1: the landing scroll measures 's2' at the line; the hold keeps 's3'.
    pane.dispatchEvent(new Event('scroll'));
    frames.flush();
    expect(result.current.activeId).toBe('s3');
    // Frame 2 releases the hold, so the next scroll belongs to the reader again.
    frames.flush();
    pane.dispatchEvent(new Event('scroll'));
    frames.flush();
    expect(result.current.activeId).toBe('s2');
  });

  it('focuses the section with preventScroll so focus never scrolls an ancestor', () => {
    const { result } = renderHook(() => useActiveSection(['s1', 's2']));
    const el = document.createElement('div');
    el.tabIndex = -1;
    const focus = vi.spyOn(el, 'focus');
    act(() => result.current.registerSection('s1', el));
    act(() => result.current.scrollToSection('s1'));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('keeps the user-picked section active when the id list changes but still contains it', () => {
    const { result, rerender } = renderHook((ids: string[]) => useActiveSection(ids), {
      initialProps: ['s1', 's2', 's3'],
    });
    act(() => result.current.activateSection('s2'));
    expect(result.current.activeId).toBe('s2');
    // Reordered and extended: 's2' is still present, so the pick must not snap
    // back to the new first entry.
    rerender(['s3', 's2', 's1', 's4']);
    expect(result.current.activeId).toBe('s2');
  });

  it('adopts the first section once an empty id list is populated after mount', () => {
    const { result, rerender } = renderHook((ids: string[]) => useActiveSection(ids), {
      initialProps: [] as string[],
    });
    expect(result.current.activeId).toBeNull();
    rerender(['s1', 's2']);
    expect(result.current.activeId).toBe('s1');
  });
});
