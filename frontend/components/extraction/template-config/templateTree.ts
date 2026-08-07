/**
 * Pure shape + search layer for the template configuration grid.
 *
 * Everything the grid renders is derived here so the components stay
 * presentational and the rules stay unit-testable: the section/field tree,
 * which metadata is worth showing, and the search predicate.
 *
 * Ground truth for the hierarchy is the DB constraint
 * `ck_extraction_entity_types_role_parent` — only `model_section` rows may
 * have a parent, and only under the single `model_container`. Generic
 * nesting does not exist (spec §3), so the tree is at most two levels deep.
 *
 * i18n-free by design: metadata comes back as copy TOKENS
 * (`metaKeys`), which the component resolves through `lib/copy`.
 */

export type TemplateSectionKind = 'root' | 'group' | 'groupChild';

/** Copy keys in the `extraction` namespace. */
export type TemplateSectionMetaKey =
  | 'sectionMetaRepeatingGroup'
  | 'sectionMetaRepeatsPerArticle'
  | 'sectionMetaRepeatsPerModel';

/** Which haystack produced a search hit — drives the "· in AI instruction" hints. */
export type TemplateMatchHint = 'label' | 'key' | 'description' | 'aiInstruction' | 'options';

const ROLE_MODEL_CONTAINER = 'model_container';
const CARDINALITY_MANY = 'many';

export interface TemplateEntityTypeInput {
  id: string;
  name: string;
  label: string | null;
  description?: string | null;
  role?: string | null;
  cardinality?: string | null;
  parent_entity_type_id?: string | null;
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
  llm_description?: string | null;
  sort_order?: number;
}

export interface GridField {
  id: string;
  entityTypeId: string;
  label: string;
  key: string;
  fieldType: string;
  isRequired: boolean;
  description: string | null;
  aiInstruction: string | null;
  hasAiInstruction: boolean;
  allowedValues: string[] | null;
  optionCount: number;
  unit: string | null;
  /** Set only while a search filter is active. */
  matchHint?: TemplateMatchHint;
}

export interface GridSection {
  id: string;
  label: string;
  key: string;
  kind: TemplateSectionKind;
  description: string | null;
  hasDescription: boolean;
  metaKeys: TemplateSectionMetaKey[];
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

/** Case- and diacritic-insensitive fold, applied to BOTH sides of a match. */
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
    label: input.label ?? input.name,
    key: input.name,
    fieldType: input.field_type,
    isRequired: Boolean(input.is_required),
    description: input.description ?? null,
    aiInstruction,
    hasAiInstruction: aiInstruction !== null,
    allowedValues: options,
    optionCount: options?.length ?? 0,
    unit: input.unit?.trim() ? input.unit : null,
  };
}

function metaKeysFor(
  kind: TemplateSectionKind,
  cardinality: string | null | undefined,
): TemplateSectionMetaKey[] {
  // Only the non-default is labelled: "one per article" is the norm and
  // stays silent, so the eye lands on the sections that behave differently.
  if (kind === 'group') return ['sectionMetaRepeatingGroup'];
  if (cardinality !== CARDINALITY_MANY) return [];
  return kind === 'groupChild'
    ? ['sectionMetaRepeatsPerModel']
    : ['sectionMetaRepeatsPerArticle'];
}

function toGridSection(
  entityType: TemplateEntityTypeInput,
  kind: TemplateSectionKind,
  fields: GridField[],
  children: GridSection[],
): GridSection {
  const description = entityType.description?.trim() ? entityType.description : null;
  return {
    id: entityType.id,
    label: entityType.label ?? entityType.name,
    key: entityType.name,
    kind,
    description,
    hasDescription: description !== null,
    metaKeys: metaKeysFor(kind, entityType.cardinality),
    fields,
    children,
    fieldCount: fields.length,
    totalFieldCount:
      fields.length + children.reduce((sum, child) => sum + child.totalFieldCount, 0),
  };
}

/**
 * Build the ordered two-level tree the grid renders.
 *
 * A child whose parent is missing from the input is surfaced as a root
 * rather than dropped — losing a section silently would be worse than
 * showing it in the wrong place.
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

  return roots.map((entityType) => {
    const isGroup = entityType.role === ROLE_MODEL_CONTAINER;
    const children = (childrenByParent.get(entityType.id) ?? []).map((child) =>
      toGridSection(child, 'groupChild', fieldsByEntityType.get(child.id) ?? [], []),
    );
    return toGridSection(
      entityType,
      isGroup ? 'group' : 'root',
      fieldsByEntityType.get(entityType.id) ?? [],
      children,
    );
  });
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
  const totalCount = countFields(sections);
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
