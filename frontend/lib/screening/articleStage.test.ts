import {describe, expect, it} from 'vitest';

import {articleScreeningStage} from '@/lib/screening/articleStage';
import type {RecordStatus} from '@/lib/screening/records';
import type {ScreeningPhase, ScreeningRecordRow} from '@/services/screeningService';

function row(phase: ScreeningPhase, status: RecordStatus): ScreeningRecordRow {
  return {
    article_id: 'art-1',
    assignment_id: 'as-1',
    phase,
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
    ta_outcome: null,
    ta_outcome_kind: null,
    ta_reviewer_count: null,
    pmid: null,
    publication_year: null,
    queue_rank: 0,
    status,
    title: 'A record',
  };
}

const OFF = {fullTextOn: false, isDuplicate: false};
const ON = {fullTextOn: true, isDuplicate: false};

describe('articleScreeningStage', () => {
  it.each([
    ['a row', row('title_abstract', 'included')],
    ['no row', undefined],
  ])('names a duplicate over %s', (_name, r) => {
    const stage = articleScreeningStage(r, {fullTextOn: true, isDuplicate: true});
    expect(stage?.label).toBe('stageDuplicate');
    expect(stage?.prefix).toBeNull();
    expect(stage?.tone).toContain('border-dashed');
  });

  it('is null for an unknown, non-duplicate article', () => {
    expect(articleScreeningStage(undefined, OFF)).toBeNull();
  });

  it('shows a not-enrolled article muted and dashed, with no prefix', () => {
    const stage = articleScreeningStage(row('title_abstract', 'not_enrolled'), OFF);
    expect(stage).toMatchObject({label: 'statusNotEnrolled', prefix: null});
    expect(stage?.tone).toContain('border-dashed');
  });

  it.each([
    ['to_screen', 'statusToScreen'],
    ['waiting', 'statusWaiting'],
    ['in_review', 'statusInReview'],
    ['conflict', 'statusConflict'],
  ] as const)('prefixes an open title/abstract %s row', (status, label) => {
    expect(articleScreeningStage(row('title_abstract', status), OFF)).toMatchObject({
      label,
      prefix: 'tabTitleAbstract',
    });
  });

  it('shows a title/abstract exclusion bare and destructive', () => {
    const stage = articleScreeningStage(row('title_abstract', 'excluded'), ON);
    expect(stage).toMatchObject({label: 'statusExcluded', prefix: null});
    expect(stage?.tone).toContain('text-destructive');
  });

  it('shows title/abstract inclusion bare when full text is off', () => {
    const stage = articleScreeningStage(row('title_abstract', 'included'), OFF);
    expect(stage).toMatchObject({label: 'statusIncluded', prefix: null});
    expect(stage?.tone).toContain('text-success');
  });

  it('prefixes title/abstract inclusion when full text is on', () => {
    expect(articleScreeningStage(row('title_abstract', 'included'), ON)).toMatchObject({
      label: 'statusIncluded',
      prefix: 'tabTitleAbstract',
    });
  });

  it.each([OFF, ON])('prefixes a title/abstract maybe (%o)', (opts) => {
    expect(articleScreeningStage(row('title_abstract', 'maybe'), opts)).toMatchObject({
      label: 'statusMaybe',
      prefix: 'tabTitleAbstract',
    });
  });

  it.each([
    ['to_screen', 'statusToScreen'],
    ['waiting', 'statusWaiting'],
    ['in_review', 'statusInReview'],
    ['conflict', 'statusConflict'],
    ['not_retrieved', 'statusNotRetrieved'],
  ] as const)('prefixes an open full-text %s row', (status, label) => {
    expect(articleScreeningStage(row('full_text', status), ON)).toMatchObject({
      label,
      prefix: 'tabFullText',
    });
  });

  it('shows full-text inclusion and exclusion bare', () => {
    expect(articleScreeningStage(row('full_text', 'included'), ON)).toMatchObject({
      label: 'statusIncluded',
      prefix: null,
    });
    expect(articleScreeningStage(row('full_text', 'excluded'), ON)).toMatchObject({
      label: 'statusExcluded',
      prefix: null,
    });
  });

  it('reuses the S1 chip tone for open statuses', () => {
    expect(articleScreeningStage(row('title_abstract', 'conflict'), OFF)?.tone).toBe('bg-warning/10 text-warning');
  });
});
