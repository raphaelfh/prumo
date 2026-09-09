/**
 * Pure scrollspy decision logic for ArticleForm's section rail, extracted so
 * it can be unit-tested with real numbers — jsdom implements neither
 * IntersectionObserver geometry nor layout, so a scroll-driven test would be
 * a false green (see the observer wiring in ArticleForm.tsx).
 */

/** True when a scrollable element has reached (or is within `thresholdPx` of)
 *  its bottom edge. The rootMargin-narrowed intersection band that drives the
 *  rest of the scrollspy can never give a short last section the highest
 *  ratio once the container can't scroll any further — this is the escape
 *  hatch for that case. */
export function isScrolledToBottom(
    el: {scrollTop: number; scrollHeight: number; clientHeight: number},
    thresholdPx = 4,
): boolean {
    return el.scrollTop + el.clientHeight >= el.scrollHeight - thresholdPx;
}

/** Picks the active step from per-section intersection ratios. At the scroll
 *  container's bottom the last step wins unconditionally; otherwise the
 *  highest-ratio section wins, or `null` if nothing intersects yet. */
export function resolveActiveStep<TStep extends string>(
    ratios: Map<string, number>,
    lastStepId: TStep,
    atBottom: boolean,
): TStep | null {
    if (atBottom) return lastStepId;
    let best: TStep | null = null;
    let bestRatio = 0;
    for (const [id, ratio] of ratios) {
        if (ratio > bestRatio) {
            bestRatio = ratio;
            best = id as TStep;
        }
    }
    return best;
}
