// frontend/hooks/extraction/useActiveSection.ts
import { useCallback, useEffect, useRef, useState } from 'react';

export function pickMostVisible(
  entries: IntersectionObserverEntry[],
  current: string | null,
): string | null {
  let bestId = current;
  let bestRatio = -1;
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const id = (e.target as HTMLElement).dataset.sectionId ?? null;
    if (id && e.intersectionRatio > bestRatio) {
      bestRatio = e.intersectionRatio;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * Resolve the active section from observer entries, clamping to the last section
 * when the scroll container has bottomed out. Short trailing sections can never
 * scroll up into the activation band, so without this clamp they'd never become
 * active when the user reaches the end of the form.
 */
export function resolveActiveSection(
  entries: IntersectionObserverEntry[],
  current: string | null,
  atBottom: boolean,
  lastId: string | null,
): string | null {
  if (atBottom && lastId) return lastId;
  return pickMostVisible(entries, current);
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export interface UseActiveSectionResult {
  activeId: string | null;
  registerSection: (id: string, el: HTMLElement | null) => void;
  scrollToSection: (id: string) => void;
}

export function useActiveSection(sectionIds: string[]): UseActiveSectionResult {
  const [activeId, setActiveId] = useState<string | null>(sectionIds[0] ?? null);
  const refs = useRef(new Map<string, HTMLElement>());
  const activeRef = useRef<string | null>(activeId);
  // While a click-driven smooth scroll is in flight, the scrollspy stands down
  // so it cannot revert the section the user just clicked (which may never reach
  // the activation band — e.g. the last/short sections at the bottom).
  const suppressRef = useRef(false);
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);

  useEffect(
    () => () => {
      if (suppressTimer.current !== null) clearTimeout(suppressTimer.current);
    },
    [],
  );

  const registerSection = useCallback((id: string, el: HTMLElement | null) => {
    if (el) {
      el.dataset.sectionId = id;
      refs.current.set(id, el);
    } else {
      refs.current.delete(id);
    }
  }, []);

  const scrollToSection = useCallback((id: string) => {
    const el = refs.current.get(id);
    if (!el) return;
    // Click intent wins: mark active immediately and hold it through the scroll.
    setActiveId(id);
    activeRef.current = id;
    suppressRef.current = true;
    if (suppressTimer.current !== null) clearTimeout(suppressTimer.current);
    suppressTimer.current = setTimeout(() => {
      suppressRef.current = false;
    }, 700);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  }, []);

  const key = sectionIds.join('|');
  useEffect(() => {
    const observed = [...refs.current.values()];
    if (observed.length === 0) return;
    const scrollParent = findScrollParent(observed[0]);
    const lastId = observed[observed.length - 1].dataset.sectionId ?? null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (suppressRef.current) return;
        const atBottom =
          scrollParent !== null &&
          scrollParent.scrollTop + scrollParent.clientHeight >= scrollParent.scrollHeight - 4;
        setActiveId(resolveActiveSection(entries, activeRef.current, atBottom, lastId));
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    observed.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [key]);

  return { activeId, registerSection, scrollToSection };
}
