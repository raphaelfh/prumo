/**
 * ⌘/Ctrl `=` and `-` zoom the canvas while the pointer or focus is inside the
 * viewer; everywhere else the browser keeps its own page zoom.
 *
 * Browsers also treat ⌘/Ctrl `+` as zoom-in: on layouts where `+` needs
 * Shift (US ⌘⇧=, Brazilian ABNT) the key arrives as `'+'` with
 * `shiftKey: true`; on numpad it arrives as `'+'` with `shiftKey: false`.
 * Both are bound alongside `'='` so the browser never intercepts either.
 */
import {useEffect, useState} from 'react';
import {useKeyboardShortcuts} from '@/hooks/useKeyboardShortcuts';
import {useViewerStoreApi} from '../core/context';
import {ZOOM_STEP} from './zoomMath';

export function useZoomShortcuts(scroller: HTMLElement | null): void {
  const storeApi = useViewerStoreApi();
  const inside = usePointerOrFocusInside(scroller);
  useKeyboardShortcuts({
    enabled: inside,
    bindings: [
      {type: 'chord', key: '=', mod: true, handler: () => storeApi.getState().actions.zoomBy(ZOOM_STEP)},
      {type: 'chord', key: '+', mod: true, shift: true, handler: () => storeApi.getState().actions.zoomBy(ZOOM_STEP)},
      {type: 'chord', key: '+', mod: true, handler: () => storeApi.getState().actions.zoomBy(ZOOM_STEP)},
      {type: 'chord', key: '-', mod: true, handler: () => storeApi.getState().actions.zoomBy(1 / ZOOM_STEP)},
    ],
  });
}

/** Whether the pointer or focus is inside the viewer root around `scroller`. */
function usePointerOrFocusInside(scroller: HTMLElement | null): boolean {
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);

  useEffect(() => {
    const root = scroller?.closest<HTMLElement>('[data-pdf-viewer-root]');
    if (!root) return;
    const enter = () => setPointerInside(true);
    const leave = () => setPointerInside(false);
    const focusIn = () => setFocusInside(true);
    const focusOut = (event: FocusEvent) =>
      setFocusInside(event.relatedTarget instanceof Node && root.contains(event.relatedTarget));
    root.addEventListener('pointerenter', enter);
    root.addEventListener('pointerleave', leave);
    root.addEventListener('focusin', focusIn);
    root.addEventListener('focusout', focusOut);
    return () => {
      root.removeEventListener('pointerenter', enter);
      root.removeEventListener('pointerleave', leave);
      root.removeEventListener('focusin', focusIn);
      root.removeEventListener('focusout', focusOut);
    };
  }, [scroller]);

  return pointerInside || focusInside;
}
