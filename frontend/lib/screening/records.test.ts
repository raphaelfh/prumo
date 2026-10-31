import {describe, expect, it} from 'vitest';

import type {components} from '@/types/api/schema';

import {
  HIDDEN_AT_ZERO,
  RECORD_CSV_COLUMNS,
  STATUS_VIEWS,
  defaultStatusView,
  filterRecords,
  isReadOnly,
  nextToScreen,
  progress,
  recordsToCsv,
  sortRecords,
  statusCounts,
  visibleStatusViews,
  type StatusView,
} from './records';

type Row = components['schemas']['ScreeningRecordRow'];

let seq = 0;
function row(overrides: Partial<Row> = {}): Row {
  seq += 1;
  return {
    article_id: `a-${seq}`,
    assignment_id: `as-${seq}`,
    doi: null,
    first_author: null,
    has_pdf: false,
    ingestion_source: null,
    journal_title: null,
    my_decision: null,
    my_exclusion_reason: null,
    outcome: null,
    outcome_exclusion_reason: null,
    outcome_kind: null,
    pmid: null,
    publication_year: null,
    queue_rank: seq,
    status: 'to_screen',
    title: `Title ${seq}`,
    ...overrides,
  };
}

const COUNTS_FIXTURE: Row[] = [
  row({status: 'to_screen'}),
  row({status: 'to_screen'}),
  row({status: 'waiting'}),
  row({status: 'in_review'}),
  row({status: 'included'}),
  row({status: 'excluded'}),
  row({status: 'maybe'}),
  row({status: 'not_enrolled', assignment_id: null}),
  row({status: 'not_enrolled', assignment_id: null}),
];

function zeroCounts(): Record<StatusView, number> {
  return Object.fromEntries(STATUS_VIEWS.map((v) => [v, 0])) as Record<StatusView, number>;
}

const MANAGER = {can_manage: true, can_review: true, can_arbitrate: true};
const CONSENSUS = {can_manage: false, can_review: true, can_arbitrate: true};
const REVIEWER = {can_manage: false, can_review: true, can_arbitrate: false};
const VIEWER = {can_manage: false, can_review: false, can_arbitrate: false};

describe('STATUS_VIEWS / HIDDEN_AT_ZERO', () => {
  it('lists every view in display order and hides only conflict and not_enrolled at zero', () => {
    expect(STATUS_VIEWS).toEqual([
      'all', 'to_screen', 'waiting', 'in_review', 'conflict', 'included', 'excluded', 'maybe', 'not_enrolled',
    ]);
    expect([...HIDDEN_AT_ZERO].sort()).toEqual(['conflict', 'not_enrolled']);
  });
});

describe('statusCounts', () => {
  it('counts each status and all', () => {
    expect(statusCounts(COUNTS_FIXTURE)).toEqual({
      all: 9,
      to_screen: 2,
      waiting: 1,
      in_review: 1,
      conflict: 0,
      included: 1,
      excluded: 1,
      maybe: 1,
      not_enrolled: 2,
    });
  });
});

describe('visibleStatusViews', () => {
  it('omits a zero conflict but keeps a zero maybe', () => {
    const counts = {...statusCounts(COUNTS_FIXTURE), maybe: 0};
    const views = visibleStatusViews(counts);
    expect(views).not.toContain('conflict');
    expect(views).toContain('maybe');
    expect(views).toContain('not_enrolled');
  });

  it('omits a zero not_enrolled and keeps a non-zero conflict', () => {
    const counts = {...zeroCounts(), conflict: 1};
    const views = visibleStatusViews(counts);
    expect(views).toContain('conflict');
    expect(views).not.toContain('not_enrolled');
    expect(views[0]).toBe('all');
  });

  it('keeps the active view at zero, in its usual place', () => {
    const counts = zeroCounts();
    const views = visibleStatusViews(counts, 'conflict');
    expect(views).toContain('conflict');
    expect(views).not.toContain('not_enrolled');
    expect(views.indexOf('conflict')).toBe(STATUS_VIEWS.indexOf('conflict'));
  });
});

describe('isReadOnly', () => {
  it('is true only when no role flag is set', () => {
    expect(isReadOnly(VIEWER)).toBe(true);
    expect(isReadOnly(REVIEWER)).toBe(false);
    expect(isReadOnly(CONSENSUS)).toBe(false);
    expect(isReadOnly(MANAGER)).toBe(false);
    expect(isReadOnly({can_manage: true, can_review: false, can_arbitrate: false})).toBe(false);
    expect(isReadOnly({can_manage: false, can_review: false, can_arbitrate: true})).toBe(false);
  });
});

describe('defaultStatusView', () => {
  const withConflict = {...zeroCounts(), conflict: 2, to_screen: 3};
  const noConflict = {...zeroCounts(), to_screen: 3};

  it('manager → all, even with a conflict', () => {
    expect(defaultStatusView(MANAGER, withConflict)).toBe('all');
  });
  it('consensus with a conflict → conflict', () => {
    expect(defaultStatusView(CONSENSUS, withConflict)).toBe('conflict');
  });
  it('consensus without a conflict → to_screen', () => {
    expect(defaultStatusView(CONSENSUS, noConflict)).toBe('to_screen');
  });
  it('reviewer → to_screen, even with a conflict', () => {
    expect(defaultStatusView(REVIEWER, withConflict)).toBe('to_screen');
  });
  it('viewer → all', () => {
    expect(defaultStatusView(VIEWER, withConflict)).toBe('all');
  });
});

describe('filterRecords', () => {
  const sepsis = row({
    title: 'Early Sepsis care',
    first_author: 'Smith J',
    journal_title: 'Critical Care',
    pmid: '12345',
    doi: '10.1000/ABC',
    publication_year: 2019,
    my_decision: 'include',
    status: 'included',
    ingestion_source: 'pubmed',
  });
  const stroke = row({
    title: 'Stroke rehab',
    first_author: 'Jones K',
    journal_title: 'Neurology',
    publication_year: 2022,
    my_decision: 'exclude',
    my_exclusion_reason: 'Wrong population',
    status: 'excluded',
    ingestion_source: 'ris',
  });
  const unknown = row({
    title: 'Untitled cohort',
    publication_year: null,
    outcome_exclusion_reason: 'Wrong design',
    status: 'to_screen',
  });
  const rows = [sepsis, stroke, unknown];
  const base = {search: '', filters: {}, status: 'all' as StatusView};
  const ids = (rs: Row[]) => rs.map((r) => r.article_id);

  it('status all keeps every status', () => {
    expect(ids(filterRecords(rows, base))).toEqual(ids(rows));
  });

  it('a status view keeps only that status', () => {
    expect(ids(filterRecords(rows, {...base, status: 'excluded'}))).toEqual([stroke.article_id]);
  });

  it.each([
    ['title', 'sepsis'],
    ['first_author', 'smith'],
    ['journal_title', 'critical'],
    ['pmid', '2345'],
    ['doi', '10.1000/abc'],
  ])('search matches %s case-insensitively', (_field, term) => {
    expect(ids(filterRecords(rows, {...base, search: term}))).toEqual([sepsis.article_id]);
  });

  it('title, authors and journal filters are contains matches', () => {
    expect(ids(filterRecords(rows, {...base, filters: {title: 'REHAB'}}))).toEqual([stroke.article_id]);
    expect(ids(filterRecords(rows, {...base, filters: {authors: 'jones'}}))).toEqual([stroke.article_id]);
    expect(ids(filterRecords(rows, {...base, filters: {journal: 'neuro'}}))).toEqual([stroke.article_id]);
  });

  it('year is inclusive and excludes a null year when a bound is set', () => {
    expect(ids(filterRecords(rows, {...base, filters: {year: {min: 2019, max: 2022}}}))).toEqual([
      sepsis.article_id,
      stroke.article_id,
    ]);
    expect(ids(filterRecords(rows, {...base, filters: {year: {min: 2020}}}))).toEqual([stroke.article_id]);
    expect(ids(filterRecords(rows, {...base, filters: {year: {max: 2019}}}))).toEqual([sepsis.article_id]);
    expect(ids(filterRecords(rows, {...base, filters: {year: {}}}))).toEqual(ids(rows));
  });

  it('my_decision matches values, none = no decision', () => {
    expect(ids(filterRecords(rows, {...base, filters: {my_decision: ['include']}}))).toEqual([sepsis.article_id]);
    expect(ids(filterRecords(rows, {...base, filters: {my_decision: ['none', 'exclude']}}))).toEqual([
      stroke.article_id,
      unknown.article_id,
    ]);
  });

  it('exclusion_reason matches mine or the outcome reason', () => {
    expect(
      ids(filterRecords(rows, {...base, filters: {exclusion_reason: ['Wrong population', 'Wrong design']}})),
    ).toEqual([stroke.article_id, unknown.article_id]);
  });

  it("source matches ingestion_source, null as 'unknown'", () => {
    expect(ids(filterRecords(rows, {...base, filters: {source: ['unknown']}}))).toEqual([unknown.article_id]);
    expect(ids(filterRecords(rows, {...base, filters: {source: ['ris', 'pubmed']}}))).toEqual([
      sepsis.article_id,
      stroke.article_id,
    ]);
  });

  it('a kept row passes the status predicate whatever its status', () => {
    const keep = new Set([sepsis.article_id]);
    expect(ids(filterRecords(rows, {...base, status: 'to_screen', keep}))).toEqual([
      sepsis.article_id,
      unknown.article_id,
    ]);
  });

  it('a kept row is still dropped by a search that excludes it', () => {
    const keep = new Set([sepsis.article_id]);
    expect(ids(filterRecords(rows, {...base, status: 'to_screen', keep, search: 'untitled'}))).toEqual([
      unknown.article_id,
    ]);
  });
});

describe('sortRecords', () => {
  const a = row({title: 'beta', publication_year: 2020, status: 'included', queue_rank: 3});
  const b = row({title: 'Alpha', publication_year: 2018, status: 'to_screen', queue_rank: 2});
  const c = row({title: 'gamma', publication_year: null, status: 'conflict', queue_rank: 1});
  const d = row({title: 'delta', publication_year: 2020, status: 'to_screen', queue_rank: 4});
  const rows = [a, b, c, d];
  const ids = (rs: Row[]) => rs.map((r) => r.article_id);

  it('queue sorts by queue_rank', () => {
    expect(ids(sortRecords(rows, 'queue', 'asc'))).toEqual(ids([c, b, a, d]));
    expect(ids(sortRecords(rows, 'queue', 'desc'))).toEqual(ids([d, a, b, c]));
  });

  it('title sorts case-insensitively', () => {
    expect(ids(sortRecords(rows, 'title', 'asc'))).toEqual(ids([b, a, d, c]));
  });

  it('year sorts with ties by queue_rank', () => {
    expect(ids(sortRecords([a, b, d], 'year', 'asc'))).toEqual(ids([b, a, d]));
  });

  it('a missing year sorts last in both directions', () => {
    expect(ids(sortRecords(rows, 'year', 'asc'))).toEqual(ids([b, a, d, c]));
    expect(ids(sortRecords(rows, 'year', 'desc'))).toEqual(ids([a, d, b, c]));
  });

  it('status follows the workflow order with ties by queue_rank', () => {
    const all = [
      row({status: 'not_enrolled', queue_rank: 10}),
      row({status: 'excluded', queue_rank: 11}),
      row({status: 'included', queue_rank: 12}),
      row({status: 'maybe', queue_rank: 13}),
      row({status: 'waiting', queue_rank: 14}),
      row({status: 'in_review', queue_rank: 15}),
      row({status: 'conflict', queue_rank: 16}),
      row({status: 'to_screen', queue_rank: 18}),
      row({status: 'to_screen', queue_rank: 17}),
    ];
    expect(sortRecords(all, 'status', 'asc').map((r) => [r.status, r.queue_rank])).toEqual([
      ['to_screen', 17],
      ['to_screen', 18],
      ['conflict', 16],
      ['in_review', 15],
      ['waiting', 14],
      ['maybe', 13],
      ['included', 12],
      ['excluded', 11],
      ['not_enrolled', 10],
    ]);
  });

  it('does not mutate its input', () => {
    const input = [a, b, c, d];
    sortRecords(input, 'title', 'asc');
    expect(input).toEqual([a, b, c, d]);
  });
});

describe('progress', () => {
  it('counts enrolled, decided and my to-screen rows', () => {
    expect(progress(COUNTS_FIXTURE)).toEqual({decided: 3, enrolled: 7, myLeft: 2});
  });
});

describe('nextToScreen', () => {
  const r1 = row({status: 'to_screen', queue_rank: 1});
  const r2 = row({status: 'included', queue_rank: 2});
  const r3 = row({status: 'to_screen', queue_rank: 3});
  const r4 = row({status: 'to_screen', queue_rank: 4});
  // deliberately out of queue order
  const rows = [r4, r2, r3, r1];

  it('returns the first to_screen after the current one in queue order', () => {
    expect(nextToScreen(rows, r1.article_id)).toBe(r3);
    expect(nextToScreen(rows, r2.article_id)).toBe(r3);
  });

  it('wraps to the first to_screen overall', () => {
    expect(nextToScreen(rows, r4.article_id)).toBe(r1);
  });

  it('with no current row returns the first to_screen', () => {
    expect(nextToScreen(rows, null)).toBe(r1);
  });

  it('never returns the current row', () => {
    expect(nextToScreen([r1, r2], r1.article_id)).toBeNull();
  });

  it('returns null when nothing is to screen', () => {
    expect(nextToScreen([r2], null)).toBeNull();
  });
});

describe('recordsToCsv', () => {
  it('exports the 17 wire fields in wire order, without abstract', () => {
    expect(RECORD_CSV_COLUMNS).toEqual([
      'article_id', 'assignment_id', 'queue_rank', 'title', 'first_author', 'publication_year', 'journal_title',
      'pmid', 'doi', 'ingestion_source', 'has_pdf', 'status', 'my_decision', 'my_exclusion_reason', 'outcome',
      'outcome_exclusion_reason', 'outcome_kind',
    ]);
    expect(RECORD_CSV_COLUMNS).not.toContain('abstract');
  });

  it('writes a header, quotes per RFC 4180, null as empty, CRLF lines', () => {
    const r = row({
      article_id: 'x1',
      assignment_id: null,
      queue_rank: 1,
      title: 'Sepsis, "early" care',
      first_author: 'Line\nbreak',
      publication_year: 2020,
      has_pdf: true,
      status: 'not_enrolled',
    });
    const lines = recordsToCsv([r]).split('\r\n');
    expect(lines[0]).toBe(RECORD_CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      'x1,,1,"Sepsis, ""early"" care","Line\nbreak",2020,,,,,true,not_enrolled,,,,,',
    );
  });

  it.each([
    ['=', '=HYPERLINK("x")', `"'=HYPERLINK(""x"")"`],
    ['+', '+1', "'+1"],
    ['-', '-2+3', "'-2+3"],
    ['@', '@SUM(A1)', "'@SUM(A1)"],
    ['tab', '\tcmd', "'\tcmd"],
    ['CR', '\rcmd', `"'\rcmd"`],
  ])('guards a string cell starting with %s against formula injection', (_lead, title, cell) => {
    const r = row({article_id: 'x2', title});
    const fields = recordsToCsv([r]).split('\r\n').slice(1).join('\r\n');
    expect(fields.startsWith(`x2,as-`)).toBe(true);
    expect(fields).toContain(`,${cell},`);
  });

  it('leaves a plain cell and a negative-looking number untouched', () => {
    const r = row({article_id: 'x3', title: 'Plain - title', publication_year: 2021});
    const line = recordsToCsv([r]).split('\r\n')[1];
    expect(line).toContain(',Plain - title,');
    expect(line).toContain(',2021,');
  });
});
