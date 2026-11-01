/**
 * ScreeningRecordTable below `sm` (card list): the j/k cursor marks its card,
 * as the table row does from `sm` up. jsdom has no layout, so this pins the
 * marker and its ring utility; the ring's look is design-review's job.
 */
import {render} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {ScreeningRecordTable} from '@/components/screening/ScreeningRecordTable';
import type {ScreeningRecordRow} from '@/services/screeningService';

const row = (id: string, title: string): ScreeningRecordRow => ({
  article_id: id,
  assignment_id: `as-${id}`,
  doi: null,
  first_author: 'Smith J',
  has_pdf: false,
  ingestion_source: 'pubmed',
  journal_title: 'Lancet',
  my_decision: null,
  my_exclusion_reason: null,
  outcome: null,
  outcome_exclusion_reason: null,
  outcome_kind: null,
  pmid: null,
  publication_year: 2021,
  queue_rank: 1,
  status: 'to_screen',
  title,
});

function renderCards(cursorArticleId: string | null) {
  return render(
    <ScreeningRecordTable
      rows={[row('a', 'Aspirin trial'), row('b', 'Statin cohort')]}
      scroller={null}
      isNarrow
      showMine={false}
      showReason={false}
      activeArticleId={null}
      cursorArticleId={cursorArticleId}
      checkedIds={new Set()}
      onCheckedChange={() => {}}
      onToggleRow={() => {}}
      onOpenRow={() => {}}
    />,
  );
}

describe('ScreeningRecordTable — narrow card list', () => {
  it('marks the cursor card with a ring, and only that card', () => {
    const {container} = renderCards('b');
    expect(container.querySelector('table')).toBeNull();

    const marked = container.querySelectorAll('[data-cursor]');
    expect(marked).toHaveLength(1);
    expect(marked[0].getAttribute('data-record-row')).toBe('b');
    expect(marked[0].firstElementChild?.className).toMatch(/\bring-1\b/);
    expect(marked[0].textContent).toContain('Statin cohort');
  });

  it('marks no card without a cursor', () => {
    const {container} = renderCards(null);
    expect(container.querySelectorAll('[data-cursor]')).toHaveLength(0);
  });
});
