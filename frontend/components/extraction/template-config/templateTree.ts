/**
 * Pure shape + search layer for the template configuration grid.
 *
 * Everything the grid renders is derived here so the components stay
 * presentational and the rules stay unit-testable: the section/field tree,
 * which metadata is worth showing, and the search predicate.
 *
 * Ground truth for the hierarchy is `parent_entity_type_id` alone: 0069
 * dropped `ck_extraction_entity_types_role_parent`, so a group may own a
 * group at any depth and a template may hold several root groups.
 *
 * The builder below is still the two-level one that CHECK justified, so a
 * grandchild does not render on the Config tab. Trees B5b makes it
 * recursive (spec §9: `depth`, `ownsChildren`, ghost rows and move targets
 * keyed by parent id at any depth). Everything that WRITES the tree — the
 * section service, the create endpoint, the run form — is already
 * depth-agnostic; only this read is not.
 *
 * i18n-free by design: metadata comes back as copy TOKENS
 * (`metaKeys`), which the component resolves through `lib/copy`.
 */

import {DEFAULT_ENTRY_NOUN} from '@/lib/extraction/entryKey';


/** Copy keys in the `extraction` namespace. */
type TemplateSectionMetaKey =
  | 'sectionMetaRepeatingGroup'
  | 'sectionMetaRepeatsPerArticle'
  | 'sectionMetaRepeatsPerEntry';

/** Which haystack produced a search hit — drives the "· in AI instruction" hints. */
export type TemplateMatchHint = 'label' | 'key' | 'description' | 'aiInstruction' | 'options';

const CARDINALITY_MANY = 'many';

/** Copy keys in the `extraction` namespace naming each field type. */
export type FieldTypeCopyKey =
  | 'fieldTypeText'
  | 'fieldTypeNumber'
  | 'fieldTypeDate'
  | 'fieldTypeSelect'
  | 'fieldTypeMultiselect'
  | 'fieldTypeBoolean';

/** The six field types (same set as the DB enum), labelled through copy —
 * shared by the inspector's type select and the grid's type menu. */
export const FIELD_TYPE_OPTIONS: ReadonlyArray<{
  value: string;
  copyKey: FieldTypeCopyKey;
}> = [
  {value: 'text', copyKey: 'fieldTypeText'},
  {value: 'number', copyKey: 'fieldTypeNumber'},
  {value: 'date', copyKey: 'fieldTypeDate'},
  {value: 'select', copyKey: 'fieldTypeSelect'},
  {value: 'multiselect', copyKey: 'fieldTypeMultiselect'},
  {value: 'boolean', copyKey: 'fieldTypeBoolean'},
];

export interface TemplateEntityTypeInput {
  id: string;
  name: string;
  label: string | null;
  description?: string | null;
  cardinality?: string | null;
  /** NOT NULL server-side. Needed to restore a deleted section exactly. */
  is_required?: boolean;
  parent_entity_type_id?: string | null;
  /** Entry noun (B-8, entry-group train) — set on repeating sections; null on legacy rows. */
  entry_label?: string | null;
  sort_order?: number;
}

export interface TemplateFieldInput {
  id: string;
  entity_type_id: string;
  name: string;
  label: string | null;
  description?: string | null;
  field_type: string;
  is_required?: boolean;
  allowed_values?: string[] | null;
  unit?: string | null;
  allowed_units?: string[] | null;
  allow_other?: boolean;
  other_label?: string | null;
  other_placeholder?: string | null;
  allows_not_applicable?: boolean;
  allows_not_evaluated?: boolean;
  /** 0062 — absent on a pre-migration payload, where the marker WAS
   * available, so absence reads as TRUE (unlike its two siblings). */
  allows_no_information?: boolean;
  /** 0059 — absent on a pre-migration payload, which reads as "no key". */
  is_entity_key?: boolean;
  llm_description?: string | null;
  validation_schema?: Record<string, unknown> | null;
  sort_order?: number;
}

export interface GridField {
  id: string;
  entityTypeId: string;
  /** Committed per-section position as fetched. UNREAD by the B-6
   * move/reorder writes — renumbering derives new sort_orders from array
   * INDEX (`fieldMove`), never from this value; absent on the wire
   * defaults to 0 like `bySortOrder`. */
  sortOrder: number;
  label: string;
  key: string;
  fieldType: string;
  isRequired: boolean;
  /** 0059: this field's value identifies an instance of a repeating
   * section. At most one per section. */
  isEntityKey: boolean;
  description: string | null;
  aiInstruction: string | null;
  hasAiInstruction: boolean;
  allowedValues: string[] | null;
  optionCount: number;
  unit: string | null;
  /** B-5 Task 5 — everything the inspector edits rides the projection so
   * PENDING optimistic rows (which have no raw ExtractionField) can still
   * open the full form; absent columns default to off/empty until the
   * drain refetch serves the committed row. */
  allowedUnits: string[] | null;
  allowOther: boolean;
  otherLabel: string | null;
  otherPlaceholder: string | null;
  allowsNotApplicable: boolean;
  allowsNotEvaluated: boolean;
  /** Carried so an Undo restore can resend it — the create endpoint
   * defaults it to TRUE, so omitting it re-enables the NI marker on a
   * field that had it off (mirrors `sectionRestore`). */
  allowsNoInformation: boolean;
  /** Carried so an Undo restore can resend it verbatim. OPTIONAL — not
   * required — so existing GridField test fixtures keep compiling (the
   * panel test file sits at its file-size ratchet ceiling); the builder
   * always sets it. */
  validationSchema?: Record<string, unknown> | null;
  /** Set only while a search filter is active. */
  matchHint?: TemplateMatchHint;
}

export interface GridSection {
  id: string;
  label: string;
  key: string;
  /** 0 for a root section, +1 per level of nesting. Unbounded since 0069
   * dropped the CHECK that capped the tree at two levels. Replaces the
   * three-way `kind`, together with `repeats` and `ownsChildren`: a
   * section can now be a group AND a group's child at once, which the
   * three kinds could not say. */
  depth: number;
  /** `cardinality === 'many'` — the section is filled once per ENTRY of
   * itself, and so may own children and offers the add-child ghost. */
  repeats: boolean;
  ownsChildren: boolean;
  description: string | null;
  hasDescription: boolean;
  metaKeys: TemplateSectionMetaKey[];
  /** What ONE ENTRY OF THIS SECTION is called: `entry_label ??
   * DEFAULT_ENTRY_NOUN`. Meaningful only when `repeats` — it names the
   * scope this section opens ("New per-{{noun}} section"). */
  entryNoun: string;
  /** What one entry of the nearest REPEATING ANCESTOR is called — the
   * scope this section sits IN ("repeats per {{noun}}"). Null at article
   * scope. Was conflated into `entryNoun`, which two levels could get
   * away with because a section was never both a group and a child. */
  scopeNoun: string | null;
  /** The section's OWN `entry_label`, unresolved — null when unset, which
   * the inspector renders as an empty noun field rather than the
   * fallback. */
  ownEntryLabel: string | null;
  /** Raw cardinality ('one' | 'many' on the wire, absent → 'one') — the
   * inspector's Repeats affordances read and edit it (B-8 T6). */
  cardinality: string;
  fields: GridField[];
  children: GridSection[];
  /** Fields owned directly by this section. */
  fieldCount: number;
  /** Own fields plus every descendant's — what the inspector shows for a group. */
  totalFieldCount: number;
}

export interface FilteredTemplateTree {
  sections: GridSection[];
  isFiltering: boolean;
  matchCount: number;
  totalCount: number;
}

/** One destination for the inspector's Section move combobox (B-6 T4) —
 * ALWAYS derived from the current template's tree: the RLS write policy
 * does not block cross-template moves, so this list is the client-side
 * guard (B-7 owns the server fix). `fieldCount` lets the panel land a
 * pick at the destination's END without a tree walk. */
export interface MoveTargetSection {
  id: string;
  label: string;
  /** Indents the option in the combobox — the list is flat, so depth is
   * the only thing that still shows where a destination sits. */
  depth: number;
  fieldCount: number;
}

/** Every section as a move destination, in tree order (a section
 * immediately followed by its whole subtree) — fields carry no placement
 * constraints, so all are legal. Recursive since 0069: a two-level
 * flatten silently dropped every grandchild from the picker, so a field
 * could not be moved INTO one. */
export function deriveMoveTargets(sections: GridSection[]): MoveTargetSection[] {
  return sections.flatMap((section) => [
    {id: section.id, label: section.label, depth: section.depth, fieldCount: section.fieldCount},
    ...deriveMoveTargets(section.children),
  ]);
}

export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip the combining-mark block NFD produced
    .toLowerCase()
    .trim();
}

function bySortOrder<T extends {sort_order?: number}>(a: T, b: T): number {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
}

function toGridField(input: TemplateFieldInput): GridField {
  const options = input.allowed_values ?? null;
  const aiInstruction = input.llm_description?.trim() ? input.llm_description : null;
  return {
    id: input.id,
    entityTypeId: input.entity_type_id,
    sortOrder: input.sort_order ?? 0,
    label: input.label ?? input.name,
    key: input.name,
    fieldType: input.field_type,
    isRequired: Boolean(input.is_required),
    isEntityKey: Boolean(input.is_entity_key),
    description: input.description ?? null,
    aiInstruction,
    hasAiInstruction: aiInstruction !== null,
    allowedValues: options,
    optionCount: options?.length ?? 0,
    unit: input.unit?.trim() ? input.unit : null,
    allowedUnits: input.allowed_units ?? null,
    allowOther: Boolean(input.allow_other),
    otherLabel: input.other_label ?? null,
    otherPlaceholder: input.other_placeholder ?? null,
    allowsNotApplicable: Boolean(input.allows_not_applicable),
    allowsNotEvaluated: Boolean(input.allows_not_evaluated),
    allowsNoInformation: input.allows_no_information !== false,
    validationSchema: input.validation_schema ?? {},
  };
}

function toGridSection(
  entityType: TemplateEntityTypeInput,
  node: {
    depth: number;
    repeats: boolean;
    entryNoun: string;
    scopeNoun: string | null;
    fields: GridField[];
    children: GridSection[];
  },
): GridSection {
  const description = entityType.description?.trim() ? entityType.description : null;
  const {depth, repeats, entryNoun, scopeNoun, fields, children} = node;
  const ownsChildren = children.length > 0;
  return {
    id: entityType.id,
    label: entityType.label ?? entityType.name,
    key: entityType.name,
    depth,
    repeats,
    ownsChildren,
    description,
    hasDescription: description !== null,
    metaKeys: metaKeysFor({repeats, ownsChildren, scopeNoun}),
    entryNoun,
    scopeNoun,
    ownEntryLabel: entityType.entry_label ?? null,
    cardinality: entityType.cardinality ?? 'one',
    fields,
    children,
    fieldCount: fields.length,
    totalFieldCount:
      fields.length + children.reduce((sum, child) => sum + child.totalFieldCount, 0),
  };
}

function metaKeysFor(
  section: {repeats: boolean; ownsChildren: boolean; scopeNoun: string | null},
): TemplateSectionMetaKey[] {
  // Only the non-default is labelled: "one per article" is the norm and
  // stays silent, so the eye lands on the sections that behave differently.
  if (section.repeats && section.ownsChildren) return ['sectionMetaRepeatingGroup'];
  if (!section.repeats) return [];
  // A repeating section INSIDE another entry repeats per that entry; one
  // at article scope repeats per article. Keyed on the scope, not on a
  // kind — since 0069 a section can be both a group and a child.
  return section.scopeNoun !== null
    ? ['sectionMetaRepeatsPerEntry']
    : ['sectionMetaRepeatsPerArticle'];
}

/**
 * Build the ordered tree the grid renders, at any depth.
 *
 * A child whose parent is missing from the input is surfaced as a root
 * rather than dropped — losing a section silently would be worse than
 * showing it in the wrong place. A parent CYCLE is salvaged the same way:
 * its members are unreachable from any real root, so the first one left
 * unvisited is surfaced as a root and `seen` stops the walk when it comes
 * back around. Neither is reachable through the API; a builder that hangs
 * the Config tab is worse than one that shows an odd tree.
 */
export function buildTemplateTree(
  entityTypes: TemplateEntityTypeInput[],
  fields: TemplateFieldInput[],
): GridSection[] {
  const fieldsByEntityType = new Map<string, GridField[]>();
  for (const field of [...fields].sort(bySortOrder)) {
    const bucket = fieldsByEntityType.get(field.entity_type_id) ?? [];
    bucket.push(toGridField(field));
    fieldsByEntityType.set(field.entity_type_id, bucket);
  }

  const ordered = [...entityTypes].sort(bySortOrder);
  const ids = new Set(ordered.map((et) => et.id));
  const childrenByParent = new Map<string, TemplateEntityTypeInput[]>();
  const roots: TemplateEntityTypeInput[] = [];

  for (const entityType of ordered) {
    const parentId = entityType.parent_entity_type_id;
    if (parentId && ids.has(parentId)) {
      const bucket = childrenByParent.get(parentId) ?? [];
      bucket.push(entityType);
      childrenByParent.set(parentId, bucket);
    } else {
      roots.push(entityType);
    }
  }

  const seen = new Set<string>();

  const build = (
    entityType: TemplateEntityTypeInput,
    depth: number,
    scopeNoun: string | null,
  ): GridSection => {
    seen.add(entityType.id);
    const repeats = entityType.cardinality === CARDINALITY_MANY;
    const entryNoun = entityType.entry_label ?? DEFAULT_ENTRY_NOUN;
    // A section's children sit inside ONE ENTRY of it when it repeats;
    // otherwise they stay in whatever scope it is in.
    const childScope = repeats ? entryNoun : scopeNoun;
    const children = (childrenByParent.get(entityType.id) ?? [])
      .filter((child) => !seen.has(child.id))
      .map((child) => build(child, depth + 1, childScope));
    return toGridSection(entityType, {
      depth,
      repeats,
      entryNoun,
      scopeNoun,
      fields: fieldsByEntityType.get(entityType.id) ?? [],
      children,
    });
  };

  const tree = roots.map((entityType) => build(entityType, 0, null));
  for (const entityType of ordered) {
    if (!seen.has(entityType.id)) tree.push(build(entityType, 0, null));
  }
  return tree;
}

function fieldMatchHint(field: GridField, terms: string[]): TemplateMatchHint | null {
  // Ordered by what the user most likely typed, so the hint names the
  // least obvious haystack that explains the hit.
  const haystacks: Array<[TemplateMatchHint, string]> = [
    ['label', field.label],
    ['key', field.key],
    ['description', field.description ?? ''],
    ['aiInstruction', field.aiInstruction ?? ''],
    ['options', (field.allowedValues ?? []).join(' ')],
  ];
  const normalized = haystacks.map(
    ([hint, text]) => [hint, normalizeForSearch(text)] as const,
  );
  const combined = normalized.map(([, text]) => text).join(' ');
  if (!terms.every((term) => combined.includes(term))) return null;

  // Report the first haystack that carries a term the label does not.
  const label = normalized[0][1];
  const uncovered = terms.filter((term) => !label.includes(term));
  if (uncovered.length === 0) return 'label';
  for (const [hint, text] of normalized.slice(1)) {
    if (uncovered.every((term) => text.includes(term))) return hint;
  }
  return 'label';
}

function sectionSelfMatches(section: GridSection, terms: string[]): boolean {
  const haystack = normalizeForSearch(
    [section.label, section.key, section.description ?? ''].join(' '),
  );
  return terms.every((term) => haystack.includes(term));
}

/** Every section id in the tree, roots and their children. */
export function collectSectionIds(sections: GridSection[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: GridSection[]): void => {
    for (const section of nodes) {
      ids.add(section.id);
      walk(section.children);
    }
  };
  walk(sections);
  return ids;
}

export function findField(sections: GridSection[], fieldId: string): GridField | null {
  for (const section of sections) {
    const own = section.fields.find((f) => f.id === fieldId);
    if (own) return own;
    const nested = findField(section.children, fieldId);
    if (nested) return nested;
  }
  return null;
}

/** Recursive since 0069: the two-level lookup this replaces returned null
 * for a grandchild, so selecting one in the grid opened an empty
 * inspector. */
export function findSection(
  sections: GridSection[],
  sectionId: string,
): GridSection | null {
  for (const section of sections) {
    if (section.id === sectionId) return section;
    const nested = findSection(section.children, sectionId);
    if (nested) return nested;
  }
  return null;
}

/** The section that owns `sectionId`, or null when it is a root. */
export function findParentSection(
  sections: GridSection[],
  sectionId: string,
  parent: GridSection | null = null,
): GridSection | null {
  for (const section of sections) {
    if (section.id === sectionId) return parent;
    const found = findParentSection(section.children, sectionId, section);
    if (found) return found;
  }
  return null;
}

function countFields(sections: GridSection[]): number {
  return sections.reduce(
    (sum, section) => sum + section.fields.length + countFields(section.children),
    0,
  );
}

function filterSection(section: GridSection, terms: string[]): GridSection | null {
  const selfMatches = sectionSelfMatches(section, terms);

  const fields: GridField[] = [];
  for (const field of section.fields) {
    const matchHint = fieldMatchHint(field, terms);
    if (matchHint) fields.push({...field, matchHint});
  }
  const children = section.children
    .map((child) => filterSection(child, terms))
    .filter((child): child is GridSection => child !== null);

  if (fields.length > 0 || children.length > 0) {
    return {...section, fields, children};
  }
  // The section itself matched (title, key or description) but nothing
  // inside it did: show it whole rather than as an empty header, so the
  // user can see WHY it matched. Its fields still count as matches.
  if (selfMatches) return section;
  return null;
}

/**
 * Filter-the-grid search (VS Code settings style): non-matching rows are
 * removed rather than merely dimmed, and whitespace-separated terms are
 * AND-ed so each one narrows the result.
 */
export function filterTemplateTree(
  sections: GridSection[],
  query: string,
): FilteredTemplateTree {
  // The unfiltered total is already materialised per section; only the
  // filtered result needs a walk (filterSection carries the pre-filter
  // totalFieldCount through its spread, so it cannot use this shortcut).
  const totalCount = sections.reduce((sum, s) => sum + s.totalFieldCount, 0);
  const terms = normalizeForSearch(query).split(/\s+/).filter(Boolean);

  if (terms.length === 0) {
    return {sections, isFiltering: false, matchCount: totalCount, totalCount};
  }

  const filtered = sections
    .map((section) => filterSection(section, terms))
    .filter((section): section is GridSection => section !== null);

  return {
    sections: filtered,
    isFiltering: true,
    matchCount: countFields(filtered),
    totalCount,
  };
}
