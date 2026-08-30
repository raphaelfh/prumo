/**
 * The outline rail's "take me there": open whatever hides the section, then
 * scroll its header row to the top of the grid. Extracted from
 * TemplateConfigGridPanel for the file-size ratchet, and testable on its own
 * because everything it needs is an argument.
 */
import type {GridSection} from './templateTree';

/** Breathing room above a section the rail jumped to. */
const REVEAL_MARGIN_PX = 8;

/**
 * A reveal that would land within one row of the top snaps to 0 instead.
 * The only thing above the first section is the column-header row, and
 * stopping 20px down leaves it half-cut for no benefit.
 */
const REVEAL_SNAP_PX = 32;

function scrollSectionIntoView(
  scroller: HTMLElement | null,
  sectionId: string,
): void {
  // Every section header carries its id on the collapse chevron.
  const row = scroller
    ?.querySelector(`[data-cell-row="${CSS.escape(sectionId)}"]`)
    ?.closest('tr');
  if (!scroller || !row) return;

  const target = row.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  // Already on screen? Then the user is looking at it — jumping anyway would
  // scroll the column header away for no reason and cost them their place.
  // "Take me there" means nothing when you are there.
  if (target.top >= box.top && target.bottom <= box.bottom) return;

  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const top = scroller.scrollTop + target.top - box.top - REVEAL_MARGIN_PX;
  scroller.scrollTo({
    top: top < REVEAL_SNAP_PX ? 0 : top,
    behavior: reduced ? 'auto' : 'smooth',
  });
}

export function revealSection(
  scroller: HTMLElement | null,
  sectionId: string,
  tree: GridSection[],
  collapsed: ReadonlySet<string>,
  onExpand: (next: Set<string>) => void,
): void {
  // A groupChild inside a collapsed group has no row to scroll to.
  const parent = tree.find((section) =>
    section.children.some((child) => child.id === sectionId),
  );
  if (parent && collapsed.has(parent.id)) {
    const next = new Set(collapsed);
    next.delete(parent.id);
    onExpand(next);
  }
  // After that state change commits — the surface's handler-originated
  // pattern (SectionHeaderRow's focusLabelSoon), never an effect.
  queueMicrotask(() => scrollSectionIntoView(scroller, sectionId));
}
