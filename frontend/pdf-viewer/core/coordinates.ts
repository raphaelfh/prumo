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

/**
 * CSS pixel rect (relative to the page canvas element) produced by projecting
 * a PDFRect from PDF user space.
 */
export interface CSSRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Project a PDF user-space rect to CSS pixels, relative to the top-left of
 * the rendered page canvas element.
 *
 * PDF user space has its origin at the bottom-left of the page; CSS has its
 * origin at the top-left. The Y-flip formula is:
 *   top = (pageHeightPts - rect.y - rect.height) * scale
 *
 * @param rect           Bounding box in PDF user space (points).
 * @param pageHeightPts  Page height in PDF points (from PDFPageHandle.size.height).
 * @param scale          Current viewer render scale (1.0 = 100%).
 */
export function projectPdfRectToCss(
  rect: PDFRect,
  pageHeightPts: number,
  scale: number,
): CSSRect {
  return {
    left: rect.x * scale,
    top: (pageHeightPts - rect.y - rect.height) * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}
