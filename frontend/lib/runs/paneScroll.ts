/**
 * Scrolling the run form's pane — and nothing else.
 *
 * `Element.scrollIntoView` scrolls *every* scrollable ancestor, and the box
 * directly above this pane (the Radix ScrollArea root) is `overflow: hidden`:
 * it scrolls, has no scrollbar to scroll back, and takes the sticky section
 * rail off-screen with it, leaving blank space under the form. Measured on the
 * extraction screen: one click on the last section moved that root 665px and
 * the rail to -616px. So we move the one element that is meant to move.
 */

/** Matches the `scroll-mt-4` the section wrappers carry. */
const TOP_GAP = 16;

/**
 * The pane the form actually scrolls in — a nested one (`RunSplitShell`), not
 * the window. `scrollHeight > clientHeight` is part of the predicate, not an
 * optimisation: an `overflow-auto` box that does not overflow satisfies
 * `scrollTop + clientHeight >= scrollHeight`, so accepting one makes the
 * at-bottom clamp permanently true and pins the rail to the last section.
 */
export function findScrollParent(el: HTMLElement | null): HTMLElement | null {
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

/**
 * Bring `el` to the top of its pane (`start`) or to the middle of it (`center`),
 * moving only that pane. Instant, not smooth: this pane needs over a second to
 * animate a form-length scroll and stalls part-way through, and the scrollspy
 * follows every section the animation drifts past.
 */
export function scrollIntoPane(el: HTMLElement, block: 'start' | 'center' = 'start'): void {
  const pane = findScrollParent(el);
  if (!pane) {
    // Nothing overflows yet, so no ancestor can be displaced either.
    el.scrollIntoView({ block });
    return;
  }
  const target = el.getBoundingClientRect();
  const view = pane.getBoundingClientRect();
  const gap = block === 'center' ? Math.max((view.height - target.height) / 2, TOP_GAP) : TOP_GAP;
  pane.scrollTop += target.top - view.top - gap;
}
