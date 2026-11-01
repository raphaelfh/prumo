/**
 * The screening records vocabulary as pure functions over the records read
 * (`ScreeningRecordRow`): status views and their counts, the role-based
 * default view, client-side filter / sort, the progress strip, auto-advance
 * and the CSV export. Labels are attached by the components.
 */
import type {FilterValues} from '@/components/shared/list/filter-types';
import type {ScreeningPhase} from '@/services/screeningService';
import type {components} from '@/types/api/schema';

type Row = components['schemas']['ScreeningRecordRow'];

export type RecordStatus = Row['status'];
export type StatusView = 'all' | RecordStatus;

/** The values of the "my decision" filter, by phase; `none` is no decision yet. */
export function myDecisionValuesFor(phase: ScreeningPhase): readonly string[] {
  return phase === 'full_text'
    ? ['include', 'exclude', 'not_retrieved', 'none']
    : ['include', 'exclude', 'maybe', 'none'];
}

const TITLE_ABSTRACT_VIEWS: readonly StatusView[] = [
  'all', 'to_screen', 'waiting', 'in_review', 'conflict', 'included', 'excluded', 'maybe', 'not_enrolled',
];

// Full text enrols from the title/abstract snapshot (no not_enrolled) and has no maybe.
const FULL_TEXT_VIEWS: readonly StatusView[] = [
  'all', 'to_screen', 'waiting', 'in_review', 'conflict', 'included', 'excluded', 'not_retrieved',
];

export function statusViewsFor(phase: ScreeningPhase): readonly StatusView[] {
  return phase === 'full_text' ? FULL_TEXT_VIEWS : TITLE_ABSTRACT_VIEWS;
}

/** Views whose tab disappears when nothing is in them. */
export const HIDDEN_AT_ZERO: ReadonlySet<StatusView> = new Set<StatusView>(['conflict', 'not_enrolled']);

/** Every status keyed, so a count lookup never misses: a phase lists only its own views. */
export function statusCounts(rows: Row[]): Record<StatusView, number> {
  const counts = Object.fromEntries(
    [...TITLE_ABSTRACT_VIEWS, ...FULL_TEXT_VIEWS].map((view) => [view, 0]),
  ) as Record<StatusView, number>;
  for (const row of rows) counts[row.status] += 1;
  counts.all = rows.length;
  return counts;
}

/** `active` stays listed at 0: the last conflict ruled must not hide the view the user is in. */
export function visibleStatusViews(
  phase: ScreeningPhase,
  counts: Record<StatusView, number>,
  active?: StatusView,
): StatusView[] {
  return statusViewsFor(phase).filter(
    (view) => view === active || !(HIDDEN_AT_ZERO.has(view) && counts[view] === 0),
  );
}

type Roles = {can_manage: boolean; can_review: boolean; can_arbitrate: boolean};

/** A viewer: no role flag set — no decision buttons, no toolbar writes. */
export function isReadOnly(roles: Roles): boolean {
  return !roles.can_manage && !roles.can_review && !roles.can_arbitrate;
}

/**
 * Spec §4.2 as amended: every arbitrator is a reviewer in this tree, so the
 * arbitrator rule is the consensus role's.
 */
export function defaultStatusView(roles: Roles, counts: Record<StatusView, number>): StatusView {
  if (roles.can_manage) return 'all';
  if (roles.can_arbitrate) return counts.conflict > 0 ? 'conflict' : 'to_screen';
  if (roles.can_review) return 'to_screen';
  return 'all';
}

type FilterValue = FilterValues[string] | undefined;

function contains(haystack: string | null, needle: string): boolean {
  return haystack !== null && haystack.toLowerCase().includes(needle);
}

function textNeedle(value: FilterValue): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function listOf(value: FilterValue): string[] {
  if (Array.isArray(value)) return value;
  return typeof value === 'string' && value !== '' ? [value] : [];
}

function rangeOf(value: FilterValue): {min?: number; max?: number} {
  return value !== undefined && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function matchesFilters(row: Row, filters: FilterValues): boolean {
  const title = textNeedle(filters.title);
  if (title && !contains(row.title, title)) return false;
  const authors = textNeedle(filters.authors);
  if (authors && !contains(row.first_author, authors)) return false;
  const journal = textNeedle(filters.journal);
  if (journal && !contains(row.journal_title, journal)) return false;

  const {min, max} = rangeOf(filters.year);
  const hasMin = min !== undefined && min !== null;
  const hasMax = max !== undefined && max !== null;
  if (hasMin || hasMax) {
    const year = row.publication_year;
    if (year === null) return false;
    if (hasMin && year < min) return false;
    if (hasMax && year > max) return false;
  }

  const decisions = listOf(filters.my_decision);
  if (decisions.length > 0 && !decisions.includes(row.my_decision ?? 'none')) return false;
  const reasons = listOf(filters.exclusion_reason);
  if (
    reasons.length > 0 &&
    !reasons.some((reason) => reason === row.my_exclusion_reason || reason === row.outcome_exclusion_reason)
  ) {
    return false;
  }
  const pdf = listOf(filters.pdf);
  if (pdf.length > 0 && !pdf.includes(row.has_pdf ? 'attached' : 'missing')) return false;
  const sources = listOf(filters.source);
  if (sources.length > 0 && !sources.includes(row.ingestion_source ?? 'unknown')) return false;
  return true;
}

function matchesSearch(row: Row, needle: string): boolean {
  return [row.title, row.first_author, row.journal_title, row.pmid, row.doi].some((field) =>
    contains(field, needle),
  );
}

/**
 * `keep` holds the article ids decided this session in the current view: they
 * pass the status predicate (a decided row stays in To screen), never search
 * or filters.
 */
export function filterRecords(
  rows: Row[],
  q: {search: string; filters: FilterValues; status: StatusView; keep?: ReadonlySet<string>},
): Row[] {
  const needle = q.search.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (q.status === 'all' || row.status === q.status || (q.keep?.has(row.article_id) ?? false)) &&
      (needle === '' || matchesSearch(row, needle)) &&
      matchesFilters(row, q.filters),
  );
}

export type RecordSortField = 'queue' | 'title' | 'year' | 'status';

const STATUS_ORDER: Record<RecordStatus, number> = {
  to_screen: 0,
  conflict: 1,
  in_review: 2,
  waiting: 3,
  maybe: 4,
  included: 5,
  excluded: 6,
  not_retrieved: 7,
  not_enrolled: 8,
};

function compareField(a: Row, b: Row, field: RecordSortField): number {
  switch (field) {
    case 'queue':
      return a.queue_rank - b.queue_rank;
    case 'title':
      return a.title.localeCompare(b.title, undefined, {sensitivity: 'base'});
    case 'year':
      return (a.publication_year ?? 0) - (b.publication_year ?? 0);
    case 'status':
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  }
}

/** A missing year sorts after every known year in both directions. */
function missingYearLast(a: Row, b: Row, field: RecordSortField): number {
  if (field !== 'year') return 0;
  return Number(a.publication_year === null) - Number(b.publication_year === null);
}

export function sortRecords(rows: Row[], field: RecordSortField, direction: 'asc' | 'desc'): Row[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort(
    (a, b) =>
      missingYearLast(a, b, field) || sign * compareField(a, b, field) || a.queue_rank - b.queue_rank,
  );
}

const DECIDED: ReadonlySet<RecordStatus> = new Set<RecordStatus>(['included', 'excluded', 'maybe', 'not_retrieved']);

export function progress(rows: Row[]): {decided: number; enrolled: number; myLeft: number} {
  let decided = 0;
  let enrolled = 0;
  let myLeft = 0;
  for (const row of rows) {
    if (row.assignment_id !== null) enrolled += 1;
    if (DECIDED.has(row.status)) decided += 1;
    if (row.status === 'to_screen') myLeft += 1;
  }
  return {decided, enrolled, myLeft};
}

/**
 * Auto-advance: the first To screen row after the current one in queue order,
 * else the first To screen overall; never the current row itself.
 */
export function nextToScreen(rows: Row[], currentArticleId: string | null): Row | null {
  const queue = sortRecords(
    rows.filter((row) => row.status === 'to_screen' && row.article_id !== currentArticleId),
    'queue',
    'asc',
  );
  const current = rows.find((row) => row.article_id === currentArticleId);
  if (current) {
    const after = queue.find((row) => row.queue_rank > current.queue_rank);
    if (after) return after;
  }
  return queue[0] ?? null;
}

/** The §5 row fields in wire order; the records payload carries no abstract. */
export const RECORD_CSV_COLUMNS: readonly (keyof Row)[] = [
  'article_id', 'assignment_id', 'queue_rank', 'title', 'first_author', 'publication_year', 'journal_title',
  'pmid', 'doi', 'ingestion_source', 'has_pdf', 'status', 'my_decision', 'my_exclusion_reason', 'outcome',
  'outcome_exclusion_reason', 'outcome_kind', 'ta_outcome', 'ta_outcome_kind', 'ta_reviewer_count',
];

/** A spreadsheet reads a cell starting with one of these as a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function csvField(value: Row[keyof Row]): string {
  if (value === null) return '';
  const text = typeof value === 'string' && FORMULA_LEAD.test(value) ? `'${value}` : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * RFC 4180: quoted when a field holds `,`, `"` or a newline; CRLF line breaks.
 * A string cell that would open as a formula gets a leading `'` first.
 */
function toCsv(columns: readonly (keyof Row)[], rows: Row[]): string {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvField(row[column])).join(','));
  return lines.join('\r\n');
}

export function recordsToCsv(rows: Row[]): string {
  return toCsv(RECORD_CSV_COLUMNS, rows);
}
