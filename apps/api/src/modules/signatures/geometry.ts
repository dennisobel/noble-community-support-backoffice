/**
 * Where a box drawn on the displayed page lands in the PDF file.
 *
 * The editor and the signing page both show a page the way a viewer does: cropped to its visible
 * area and turned by its /Rotate setting, with (0,0) at the top-left. A box is stored as fractions
 * of that picture, so it still lines up whatever size the page is drawn at. PDF drawing happens in
 * the page's own unrotated space with (0,0) at the bottom-left, so every point has to be mapped
 * across, and anything drawn has to be turned back upright.
 */
export type Rotation = 0 | 90 | 180 | 270;

export interface PageBox {
  /** The visible area, in the page's own unrotated space. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: Rotation;
}

export function normaliseRotation(angle: number): Rotation {
  const turned = ((Math.round(angle) % 360) + 360) % 360;
  return turned === 90 || turned === 180 || turned === 270 ? turned : 0;
}

/** The page's size as it is displayed: a page turned sideways swaps its width and height. */
export function displayedSize(box: PageBox): { width: number; height: number } {
  const sideways = box.rotation === 90 || box.rotation === 270;
  return sideways
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height };
}

/** A point `u` across and `v` down the displayed page, in points, as a point in PDF page space. */
export function toPagePoint(
  box: PageBox,
  u: number,
  v: number
): { x: number; y: number } {
  switch (box.rotation) {
    case 90:
      return { x: box.x + v, y: box.y + u };
    case 180:
      return { x: box.x + box.width - u, y: box.y + v };
    case 270:
      return { x: box.x + box.width - v, y: box.y + box.height - u };
    default:
      return { x: box.x + u, y: box.y + box.height - v };
  }
}
