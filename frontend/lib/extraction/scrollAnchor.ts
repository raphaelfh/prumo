/**
 * Keep one element's top edge where the reader last saw it across a commit
 * that changes the height of what sits above it.
 *
 * The review table opens one disclosure at a time, so expanding a question
 * also collapses whichever question was open before. When that one sat higher
 * up the form, the page lost its height and every row below — including the
 * one just clicked — jumped up under the cursor, and the reviewer had to
 * scroll back to the question they were reading.
 *
 * `commit` must apply the change SYNCHRONOUSLY (wrap React state in
 * `flushSync`), because the correction is measured against the layout it
 * produces. Content that grows later, below the anchor, does not move it.
 *
 * DO NOT delete this as a no-op after testing in Chrome. Chrome and Firefox
 * implement CSS scroll anchoring (`overflow-anchor`) and absorb the jump on
 * their own, so the measured drift there is 0 with or without this. Safari
 * does not implement it at all. Measured on the review table with a 471px
 * disclosure collapsing above the clicked row, `overflow-anchor: none`:
 * 703px of drift without this helper, 0 with it.
 */
export function withPinnedTop(element: HTMLElement | null, commit: () => void): void {
  const before = element?.getBoundingClientRect().top;
  commit();
  if (!element || before === undefined) return;
  // The form's scroll node is the radix viewport inside ScrollArea, not the
  // marker div around it (see ExtractionFormPanel).
  const scroller = element.closest<HTMLElement>('[data-radix-scroll-area-viewport]');
  const delta = element.getBoundingClientRect().top - before;
  if (scroller && delta) scroller.scrollTop += delta;
}
