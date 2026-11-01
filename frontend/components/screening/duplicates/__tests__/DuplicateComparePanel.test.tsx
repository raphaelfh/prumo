import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {DuplicateComparePanel} from '@/components/screening/duplicates/DuplicateComparePanel';
import {TooltipProvider} from '@/components/ui/tooltip';
import type {DuplicatePair} from '@/services/duplicatesService';

type Side = DuplicatePair['kept'];

function side(id: string, over: Partial<Side> = {}): Side {
  return {
    article_id: id,
    title: `Title ${id}`,
    authors: ['Smith J'],
    publication_year: 2020,
    journal_title: 'Nature',
    doi: null,
    pmid: null,
    ingestion_source: 'PUBMED',
    has_pdf: false,
    has_abstract: true,
    screening_decisions: 0,
    has_review_work: false,
    ...over,
  };
}

function pair(removedOver: Partial<Side> = {}, keptOver: Partial<Side> = {}, over: Partial<DuplicatePair> = {}): DuplicatePair {
  return {
    article_id: 'rem',
    kept_article_id: 'kept',
    tier: 'exact',
    basis: 'pmid',
    match_label: 'pmid',
    removed: side('rem', removedOver),
    kept: side('kept', keptOver),
    ...over,
  };
}

function setup(p: DuplicatePair, busy = false) {
  const h = {onMerge: vi.fn(), onDistinct: vi.fn(), onSkip: vi.fn(), onUndo: vi.fn()};
  render(
    <TooltipProvider delayDuration={0}>
      <DuplicateComparePanel pair={p} busy={busy} {...h} />
    </TooltipProvider>,
  );
  return h;
}

describe('DuplicateComparePanel', () => {
  it("defaults Keep to the server's suggestion", () => {
    setup(pair());
    expect(screen.getByRole('radio', {name: 'Keep "Title kept"'})).toBeChecked();
    expect(screen.getByRole('radio', {name: 'Keep "Title rem"'})).not.toBeChecked();
  });

  it('marks differing fields with a dot', () => {
    setup(pair({publication_year: 2019, title: 'Same'}, {title: 'Same'}));
    // One dot per column on the single differing row (year).
    expect(screen.getAllByLabelText('Differs')).toHaveLength(2);
  });

  it('shows the set-aside warning when keeping the side with fewer decisions', async () => {
    setup(pair({screening_decisions: 3}, {screening_decisions: 0, title: 'Kept title'}));
    expect(
      screen.getByText("Title rem's title/abstract decisions (3) are set aside; Kept title will need screening"),
    ).toBeInTheDocument();
  });

  it('merge posts the selected keeper', async () => {
    const h = setup(pair());
    await userEvent.click(screen.getByRole('radio', {name: 'Keep "Title rem"'}));
    await userEvent.click(screen.getByRole('button', {name: 'Merge, keep selected'}));
    expect(h.onMerge).toHaveBeenCalledWith('kept', 'rem');
  });

  it('merge posts the server suggestion by default', async () => {
    const h = setup(pair());
    await userEvent.click(screen.getByRole('button', {name: 'Merge, keep selected'}));
    expect(h.onMerge).toHaveBeenCalledWith('rem', 'kept');
  });

  it('disables Merge when the removed side has review work', () => {
    setup(pair({has_review_work: true}));
    expect(screen.getByRole('button', {name: 'Merge, keep selected'})).toBeDisabled();
  });

  it('disables Merge when both sides have review work', () => {
    const h = setup(pair({has_review_work: true}, {has_review_work: true}));
    expect(screen.getByRole('button', {name: 'Merge, keep selected'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Not duplicates'})).toBeEnabled();
    expect(h.onMerge).not.toHaveBeenCalled();
  });

  it('resolved pair shows who decided and Undo', async () => {
    const h = setup(pair({}, {}, {verdict: 'duplicate', decided_by_name: 'Ana', created_at: '2026-10-01T10:00:00Z'}));
    expect(screen.getByText(/Merged by Ana/)).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Merge, keep selected'})).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: 'Undo'}));
    expect(h.onUndo).toHaveBeenCalled();
  });

  it('busy disables every button', () => {
    setup(pair(), true);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });
});
