/**
 * Presentational atoms shared by the Configuration surface's two views of
 * the same section — the outline rail and the grid's header row. They must
 * stay pixel-identical (the rail is a map of the grid), so they live here
 * rather than being written twice.
 */

/**
 * `hasDescription` marker. A drawn 5px disc, not a `●` glyph: the glyph
 * inherits the row's line-height, so it renders as a ~12x20px box that
 * pushes the neighbouring count away from the label and rides the text
 * baseline instead of the row's optical centre.
 */
export function DescriptionDot() {
  return <span aria-hidden className="size-[5px] shrink-0 rounded-full bg-primary/70" />;
}
