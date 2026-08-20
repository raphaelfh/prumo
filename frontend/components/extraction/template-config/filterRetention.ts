/**
 * Keep rows the user just edited AWAY from the active search visible
 * until the query string changes (B-5 Task 3): committing a label that no
 * longer matches must not make the row vanish mid-interaction. Retention
 * is a view concern owned by the panel's filter application (extracted
 * from TemplateConfigGridPanel in B-6 T7 for the file-size ratchet) —
 * `templateTree` stays a pure search layer. Retained rows are merged back
 * in ORIGINAL tree order; sections (and child sections) the filter
 * dropped are resurrected when they own a retained field.
 */
import type {GridField, GridSection} from './templateTree';

export function applyRetentionToFilter(
  tree: GridSection[],
  filteredSections: GridSection[],
  retained: ReadonlySet<string>,
): GridSection[] {
  if (retained.size === 0) return filteredSections;
  const filteredRoots = new Map(filteredSections.map((s) => [s.id, s]));

  const mergeSection = (
    section: GridSection,
    kept: GridSection | undefined,
  ): GridSection | null => {
    const keptFields = new Map((kept?.fields ?? []).map((f) => [f.id, f]));
    const fields = section.fields
      .map((field) => keptFields.get(field.id) ?? (retained.has(field.id) ? field : null))
      .filter((f): f is GridField => f !== null);
    const keptChildren = new Map((kept?.children ?? []).map((c) => [c.id, c]));
    const children = section.children
      .map((child) => mergeSection(child, keptChildren.get(child.id)))
      .filter((child): child is GridSection => child !== null);
    if (!kept && fields.length === 0 && children.length === 0) return null;
    return {...(kept ?? section), fields, children};
  };

  return tree
    .map((section) => mergeSection(section, filteredRoots.get(section.id)))
    .filter((section): section is GridSection => section !== null);
}
