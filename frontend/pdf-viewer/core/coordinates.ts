/**
 * Coordinate primitives in PDF user space.
 *
 * PDF user space origin is bottom-left of the page, units are points (1/72 inch).
 * Persisted citations and annotations use these types directly so coordinates
 * survive zoom changes, rotation, and engine swaps without re-projection.
 */

export interface PDFPoint {
  x: number;
  y: number;
}

export interface PDFRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A range of characters within a single page's text content.
 * `charStart` and `charEnd` are offsets into the page's concatenated text
 * (the same offsets emitted by the engine's `getTextContent()`).
 */
export interface PDFTextRange {
  page: number;       // 1-indexed
  charStart: number;
  charEnd: number;
}
