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

export interface UseActiveSectionResult {
  activeId: string | null;
  registerSection: (id: string, el: HTMLElement | null) => void;
  scrollToSection: (id: string) => void;
}

export function useActiveSection(sectionIds: string[]): UseActiveSectionResult {
  const [activeId, setActiveId] = useState<string | null>(sectionIds[0] ?? null);
  const refs = useRef(new Map<string, HTMLElement>());
  const activeRef = useRef<string | null>(activeId);

  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);

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
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  }, []);

  const key = sectionIds.join('|');
  useEffect(() => {
    const observed = [...refs.current.values()];
    if (observed.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => setActiveId(pickMostVisible(entries, activeRef.current)),
      { rootMargin: '-20% 0px -70% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    observed.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [key]);

  return { activeId, registerSection, scrollToSection };
}
