/**
 * DuplicatePairList below `sm` (card list): the j/k cursor marks its card, as
 * the table row does from `sm` up. jsdom has no layout, so this pins the
 * marker and its ring utility; the ring's look is design-review's job.
 */
import {render} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/hooks/use-mobile', () => ({useIsNarrow: () => true}));

import {DuplicatePairList} from '@/components/screening/duplicates/DuplicatePairList';
import type {DuplicatePair} from '@/services/duplicatesService';

type Side = DuplicatePair['kept'];

const side = (id: string, title: string): Side => ({
  article_id: id,
  title,
  authors: ['Smith J'],
  publication_year: 2020,
  journal_title: 'Lancet',
  doi: null,
  pmid: null,
  ingestion_source: 'PUBMED',
  has_pdf: false,
  has_abstract: true,
  screening_decisions: 0,
  has_review_work: false,
  has_refusing_work: false,
});

const pair = (removed: Side, kept: Side): DuplicatePair => ({
  article_id: removed.article_id,
  kept_article_id: kept.article_id,
  tier: 'likely',
  basis: 'title',
  match_label: 'title',
  removed,
  kept,
});

const PAIRS = [pair(side('r1', 'Aspirin copy'), side('k1', 'Aspirin')), pair(side('r2', 'Statin copy'), side('k2', 'Statin'))];

function renderList(cursorKey: string | null) {
  return render(
    <DuplicatePairList
      counts={{open: 2, exact: 0, likely: 2, possible: 0, resolved: 0}}
      view="open"
      onViewChange={() => {}}
      pairs={PAIRS}
      activeKey={null}
      cursorKey={cursorKey}
      onOpenPair={() => {}}
      toolbarActions={null}
    />,
  );
}

describe('DuplicatePairList — narrow card list', () => {
  it('marks the cursor card with a ring, and only that card', () => {
    const {container} = renderList('r2~k2');
    expect(container.querySelector('table')).toBeNull();

    const marked = container.querySelectorAll('[data-cursor]');
    expect(marked).toHaveLength(1);
    expect(marked[0].getAttribute('data-pair-row')).toBe('r2~k2');
    expect(marked[0].firstElementChild?.className).toMatch(/\bring-1\b/);
    expect(marked[0].textContent).toContain('Statin copy');
  });

  it('marks no card without a cursor', () => {
    const {container} = renderList(null);
    expect(container.querySelectorAll('[data-cursor]')).toHaveLength(0);
  });
});
