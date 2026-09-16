/**
 * The viewer's own keys, live while the pointer or focus is inside it and
 * inert everywhere else — so the browser keeps its page zoom, and the run
 * screen's own bindings keep their keys.
 *
 * ⌘/Ctrl `=` and `-` zoom the canvas and ⌘/Ctrl `0` fits its width. `R` and
 * `⇧R` turn the view clockwise and counter-clockwise (pdf.js's keys), in
 * canvas mode only — the reader is typography, not a page surface. Those two
 * are bare chords, so `useKeyboardShortcuts` keeps them out of text fields:
 * the extraction form is full of them and the pointer often rests over the
 * PDF while a reviewer types.
 *
 * Browsers also treat ⌘/Ctrl `+` as zoom-in: on layouts where `+` needs
 * Shift (US ⌘⇧=, Brazilian ABNT) the key arrives as `'+'` with
 * `shiftKey: true`; on numpad it arrives as `'+'` with `shiftKey: false`.
 * Both are bound alongside `'='` so the browser never intercepts either.
 *
 * A shortcut is a no-op while a pinch or ctrl+wheel gesture is under way
 * (`isGesturing`): committing a keyboard zoom mid-gesture races the gesture
 * controller's own commit on `end()` and loses the keypress. The key is
 * still claimed (`useKeyboardShortcuts` calls `preventDefault` before the
 * handler runs), so the browser's page zoom doesn't fire either.
 */
import {useEffect, useState} from 'react';
import {useKeyboardShortcuts} from '@/hooks/useKeyboardShortcuts';
import {useViewerStoreApi} from '../core/context';
import {ZOOM_STEP} from './zoomMath';

export function useViewerShortcuts(scroller: HTMLElement | null): void {
  const storeApi = useViewerStoreApi();
  const inside = usePointerOrFocusInside(scroller);
  const rotate = (direction: 1 | -1) => () => {
    const state = storeApi.getState();
    if (state.mode !== 'canvas') return;
    state.actions.rotateView(direction);
  };
  const unlessGesturing = (run: (state: ReturnType<typeof storeApi.getState>) => void) => () => {
    const state = storeApi.getState();
    if (state.isGesturing) return;
    run(state);
  };
  const zoomUnlessGesturing = (factor: number) => unlessGesturing((state) => state.actions.zoomBy(factor));
  useKeyboardShortcuts({
    enabled: inside,
    bindings: [
      {type: 'chord', key: '=', mod: true, handler: zoomUnlessGesturing(ZOOM_STEP)},
      {type: 'chord', key: '+', mod: true, shift: true, handler: zoomUnlessGesturing(ZOOM_STEP)},
      {type: 'chord', key: '+', mod: true, handler: zoomUnlessGesturing(ZOOM_STEP)},
      {type: 'chord', key: '-', mod: true, handler: zoomUnlessGesturing(1 / ZOOM_STEP)},
      {
        type: 'chord',
        key: '0',
        mod: true,
        handler: unlessGesturing((state) => state.actions.setZoom(state.zoom, {fitWidth: true})),
      },
      {type: 'chord', key: 'r', handler: rotate(1)},
      {type: 'chord', key: 'r', shift: true, handler: rotate(-1)},
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
