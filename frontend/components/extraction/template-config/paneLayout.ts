import {useState, type RefObject} from 'react';

/**
 * Geometry for the Configuration surface's three-pane row: outline rail |
 * grid | inspector, with a PaneResizer on each inner boundary.
 *
 * Extracted from TemplateConfigGridPanel (which sits at the file-size
 * ratchet's ceiling), and worth its own module anyway — the clamps are the
 * contract the resizers enforce, so they belong somewhere a reader can find
 * them without reading the panel.
 */

/** The grid never shrinks below this, whatever the side panes are dragged to. */
const MIN_GRID_PX = 360;

/** The rail holds one truncating label per row; it stops paying for width fast. */
export const RAIL_PANE = {min: 180, max: 340, initial: 216} as const;

/**
 * Roughly double the rail's ceiling: the inspector holds a form — an option
 * list plus two textareas — and a manager writing AI instructions wants the
 * room. Its floor is higher for the same reason.
 */
export const INSPECTOR_PANE = {min: 260, max: 560, initial: 300} as const;

export interface PaneWidths {
  railWidth: number;
  setRailWidth: (width: number) => void;
  inspectorWidth: number;
  setInspectorWidth: (width: number) => void;
  /**
   * Pixels a side pane may still claim before the grid hits its floor.
   * MEASURED from the grid element rather than derived from the two widths,
   * so it stays right whatever else is on the row — the rail is display:none
   * below its container query, and then costs nothing.
   */
  gridSlack: () => number;
}

/** Session state, like the pane toggles: framing an editing pass, not a preference. */
export function usePaneWidths(
  gridRef: RefObject<HTMLElement | null>,
): PaneWidths {
  const [railWidth, setRailWidth] = useState<number>(RAIL_PANE.initial);
  const [inspectorWidth, setInspectorWidth] = useState<number>(
    INSPECTOR_PANE.initial,
  );
  const gridSlack = () => {
    const grid = gridRef.current?.clientWidth;
    return grid === undefined ? Number.POSITIVE_INFINITY : grid - MIN_GRID_PX;
  };
  return {railWidth, setRailWidth, inspectorWidth, setInspectorWidth, gridSlack};
}
