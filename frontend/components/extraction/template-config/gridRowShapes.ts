/**
 * The visible grid rows in DOM order — the roving model's vertical axis
 * (extracted from TemplateGrid in B-6 T7; pure, no React/DOM).
 *
 * `buildRowShapes` must mirror TemplateGrid's JSX exactly: collapse
 * hides a section's fields and children, filtering hides ghost rows;
 * every section — child sections included — carries a ghost row, and
 * the template-level add-section ghost closes the list.
 */
import type {GridRowShape} from './gridCellModel';
import type {GridSection} from './templateTree';

/** The template-level add-section ghost (empty sectionId — no editor). */
export const ADD_SECTION_ROW_ID = 'ghost:template';

export const ghostRowId = (sectionId: string) => `ghost:${sectionId}`;

export function buildRowShapes(
  sections: GridSection[],
  collapsed: ReadonlySet<string>,
  isFiltering: boolean,
): GridRowShape[] {
  const rows: GridRowShape[] = [];
  for (const section of sections) {
    rows.push({rowId: section.id, kind: 'section', sectionId: section.id});
    if (collapsed.has(section.id)) continue;
    for (const field of section.fields) {
      rows.push({rowId: field.id, kind: 'field', sectionId: section.id});
    }
    if (!isFiltering) {
      rows.push({rowId: ghostRowId(section.id), kind: 'ghost', sectionId: section.id});
    }
    for (const child of section.children) {
      rows.push({rowId: child.id, kind: 'section', sectionId: child.id});
      if (collapsed.has(child.id)) continue;
      for (const field of child.fields) {
        rows.push({rowId: field.id, kind: 'field', sectionId: child.id});
      }
      if (!isFiltering) {
        rows.push({rowId: ghostRowId(child.id), kind: 'ghost', sectionId: child.id});
      }
    }
  }
  if (!isFiltering) {
    rows.push({rowId: ADD_SECTION_ROW_ID, kind: 'ghost', sectionId: ''});
  }
  return rows;
}
