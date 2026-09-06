/**
 * The visible grid rows in DOM order — the roving model's vertical axis
 * (extracted from TemplateGrid in B-6 T7; pure, no React/DOM).
 *
 * `buildRowShapes` must mirror TemplateGrid's JSX exactly: collapse
 * hides a section's fields and children, filtering hides ghost rows;
 * every section at every depth carries a field ghost row, each REPEATING
 * section closes with a dialog-opening "New per-{noun} section" ghost
 * (B-8 D9, unlocked from the group in trees B5b), and the template-level
 * add-section ghost closes the list. Dialog-opening ghosts carry `inlineEditor: false` — they have a
 * real sectionId for attribution but mount no editor, so the cell model
 * must never auto-enter edit mode on them.
 */
import type {GridRowShape} from './gridCellModel';
import type {GridSection} from './templateTree';

/** The template-level add-section ghost (empty sectionId — no editor). */
export const ADD_SECTION_ROW_ID = 'ghost:template';

export const ghostRowId = (sectionId: string) => `ghost:${sectionId}`;

/** The "New per-{noun} section" ghost closing a repeating section. */
export const groupChildGhostRowId = (groupId: string) => `ghost:group-child:${groupId}`;

export function buildRowShapes(
  sections: GridSection[],
  collapsed: ReadonlySet<string>,
  isFiltering: boolean,
): GridRowShape[] {
  const rows: GridRowShape[] = [];
  const push = (section: GridSection): void => {
    rows.push({rowId: section.id, kind: 'section', sectionId: section.id});
    if (collapsed.has(section.id)) return;
    for (const field of section.fields) {
      rows.push({rowId: field.id, kind: 'field', sectionId: section.id});
    }
    if (!isFiltering) {
      rows.push({
        rowId: ghostRowId(section.id),
        kind: 'ghost',
        sectionId: section.id,
        inlineEditor: true,
      });
    }
    for (const child of section.children) push(child);
    // Every REPEATING section closes with its add-child ghost — including
    // one that owns nothing yet, which is the only way to create its first
    // child. The old condition was "is a group" (repeats AND owns
    // children), so a childless repeating section had no way in.
    if (!isFiltering && section.repeats) {
      rows.push({
        rowId: groupChildGhostRowId(section.id),
        kind: 'ghost',
        sectionId: section.id,
        inlineEditor: false,
      });
    }
  };
  for (const section of sections) push(section);
  if (!isFiltering) {
    rows.push({
      rowId: ADD_SECTION_ROW_ID,
      kind: 'ghost',
      sectionId: '',
      inlineEditor: false,
    });
  }
  return rows;
}
