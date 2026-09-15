// frontend/hooks/extraction/useActiveSection.ts
import { useCallback, useEffect, useRef, useState } from 'react';

import { isScrolledToBottom } from '@/lib/articleFormScrollspy';
import { findScrollParent, scrollIntoPane } from '@/lib/runs/paneScroll';

/**
 * Where the "you are here" line sits below the pane's top edge. Near the top on
 * purpose: a section becomes active as its heading reaches reading position, and
 * a short first section still owns the rail while the form is scrolled to 0.
 */
const ANCHOR_PX = 120;

/**
 * The section the reader is on: the last one starting at or above the activation
 * line, or the first when none does. At the pane's bottom the last section wins —
 * a short trailing section can never reach the line, so nothing else may hold the
 * rail while the reader is looking at the end of the form.
 *
 * Positions, not intersection ratios: the input is plain numbers, so the decision
 * is testable in jsdom (which has neither layout nor observer geometry), and a
 * merely tall section can no longer outvote the one being read.
 */
export function pickActiveSection(
  tops: readonly { id: string; top: number }[],
  anchor: number,
  atBottom: boolean,
): string | null {
  if (tops.length === 0) return null;
  if (atBottom) return tops[tops.length - 1].id;
  let active = tops[0].id;
  for (const { id, top } of tops) {
    if (top <= anchor) active = id;
  }
  return active;
}

export interface UseActiveSectionResult {
  activeId: string | null;
  registerSection: (id: string, el: HTMLElement | null) => void;
  scrollToSection: (id: string) => void;
  /** Paint the rail now — for a caller that scrolls something else (the jump). */
  activateSection: (id: string) => void;
}

/**
 * `pinnedId` hands the rail to a caller that already knows the section (review
 * focus mode shows one question): while set, it is the active section and the
 * scroll spy is detached — a pane that bottoms out would otherwise hand the rail
 * to the last section. Without it the spy owns the rail as before.
 */
export function useActiveSection(sectionIds: string[], pinnedId?: string): UseActiveSectionResult {
  const [activeId, setActiveId] = useState<string | null>(sectionIds[0] ?? null);
  const refs = useRef(new Map<string, HTMLElement>());
  // A programmatic scroll owns the highlight until it lands: the pane cannot
  // always bring the picked section to the activation line (the trailing ones),
  // so the spy would read the landing position and hand the rail straight back.
  const settling = useRef(0);

  const registerSection = useCallback((id: string, el: HTMLElement | null) => {
    if (el) {
      el.dataset.sectionId = id;
      refs.current.set(id, el);
    } else {
      refs.current.delete(id);
    }
  }, []);

  // Two frames: the scroll event fires in the next rendering update, before the
  // frame callbacks queued from inside one.
  const holdThroughScroll = useCallback(() => {
    settling.current += 1;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        settling.current -= 1;
      });
    });
  }, []);

  const activateSection = useCallback(
    (id: string) => {
      setActiveId(id);
      holdThroughScroll();
    },
    [holdThroughScroll],
  );

  const scrollToSection = useCallback(
    (id: string) => {
      activateSection(id);
      const el = refs.current.get(id);
      if (!el) return;
      scrollIntoPane(el, 'start');
      el.focus({ preventScroll: true });
    },
    [activateSection],
  );

  const key = sectionIds.join('|');
  const pinned = pinnedId !== undefined && sectionIds.includes(pinnedId) ? pinnedId : null;
  // Set while a pin detaches the spy: releasing it must measure once, because
  // leaving focus mode moves the form without a scroll event to report it.
  const wasPinned = useRef(false);
  useEffect(() => {
    const ids = key === '' ? [] : key.split('|');
    if (ids.length === 0) return;
    if (pinned !== null) {
      wasPinned.current = true;
      return;
    }
    // Resolved on use, not at setup: the pane only overflows once the form has
    // laid out, and a miss here would silently disable the spy for good.
    let scroller: HTMLElement | null = null;
    let frame = 0;
    const apply = () => {
      frame = 0;
      if (settling.current > 0) return;
      scroller = scroller ?? findScrollParent(refs.current.get(ids[0]) ?? null);
      if (!scroller) return;
      const view = scroller.getBoundingClientRect();
      const tops = ids.flatMap((id) => {
        const el = refs.current.get(id);
        return el ? [{ id, top: el.getBoundingClientRect().top - view.top }] : [];
      });
      const next = pickActiveSection(tops, ANCHOR_PX, isScrolledToBottom(scroller));
      if (next) setActiveId(next);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(apply);
    };
    // Capture: a scroll event does not bubble, and the pane that scrolls is a
    // nested one — listening at the document catches it wherever it is.
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    if (wasPinned.current) {
      wasPinned.current = false;
      onScroll();
    }
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [key, pinned]);

  // `sectionIds` can arrive after mount (an async-loaded form) or drop the
  // current pick (sections removed): fall back to the first id during render
  // rather than storing the fallback in state, which would need a setState
  // call inside the effect above.
  return {
    activeId: pinned ?? (activeId !== null && sectionIds.includes(activeId) ? activeId : (sectionIds[0] ?? null)),
    registerSection,
    scrollToSection,
    activateSection,
  };
}
