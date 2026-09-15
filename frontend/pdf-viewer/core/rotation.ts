import type {PageRotation} from './engine';

/** A page's rotation on screen: the PDF's own `/Rotate` plus the user's view rotation. */
export function effectiveRotation(
  page: {readonly rotation: PageRotation},
  viewRotation: PageRotation,
): PageRotation {
  return ((page.rotation + viewRotation) % 360) as PageRotation;
}

/**
 * A page's on-screen size at `zoom`. `size` is the page's displayed size at its
 * own rotation (`PDFPageHandle.size`); a quarter view rotation swaps it.
 */
export function displayedSize(
  size: {width: number; height: number},
  viewRotation: PageRotation,
  zoom: number,
): {width: number; height: number} {
  const quarterTurn = viewRotation % 180 !== 0;
  return {
    width: (quarterTurn ? size.height : size.width) * zoom,
    height: (quarterTurn ? size.width : size.height) * zoom,
  };
}
