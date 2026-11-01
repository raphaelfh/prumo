/**
 * ConflictRulingForm — the arbitrator's ruling inside the record panel:
 * reviewers labelled by letter (never by name), adopt one decision or decide
 * differently, an optional note, every decision id ruled on.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {ConflictRulingForm} from '@/components/screening/ConflictRulingForm';
import type {ScreeningArbitrationCreate, ScreeningAssignmentRead} from '@/services/screeningService';

const READ: ScreeningAssignmentRead = {
  id: 'a1',
  project_id: 'p1',
  status: 'conflict',
  exclusion_reasons: ['Wrong population', 'Not ML'],
  article: {
    id: 'art1',
    title: 'Deep learning for sepsis',
    abstract: 'We trained a model on ICU data.',
    authors: null,
    doi: null,
    journal_title: null,
    pmid: null,
    publication_year: null,
    mesh_terms: null,
    keywords: null,
    article_type: null,
    language: null,
  },
  my_decision: null,
  outcome: null,
  peer_decisions: [
    {
      id: 'dA',
      reviewer_id: 'rA',
      reviewer_name: 'Reviewer A Name',
      decision: 'include',
      exclusion_reason: null,
      rationale: null,
      created_at: '2026-10-01T10:00:00Z',
    },
    {
      id: 'dB',
      reviewer_id: 'rB',
      reviewer_name: 'Reviewer B Name',
      decision: 'exclude',
      exclusion_reason: 'Not ML',
      rationale: null,
      created_at: '2026-10-01T11:00:00Z',
    },
  ],
};

function renderForm(busy = false) {
  const onRule = vi.fn<(body: ScreeningArbitrationCreate) => void>();
  render(<ConflictRulingForm read={READ} busy={busy} onRule={onRule} />);
  return onRule;
}

describe('ConflictRulingForm', () => {
  it('labels reviewers A and B, never by name', () => {
    renderForm();
    expect(screen.getByText('Reviewer A')).toBeInTheDocument();
    expect(screen.getByText('Reviewer B')).toBeInTheDocument();
    expect(screen.getByText('Not ML')).toBeInTheDocument();
    expect(screen.queryByText('Reviewer A Name')).toBeNull();
    expect(screen.queryByText('Reviewer B Name')).toBeNull();
  });

  it("shows each reviewer's note under their label", () => {
    const withNote: ScreeningAssignmentRead = {
      ...READ,
      peer_decisions: [{...READ.peer_decisions[0], rationale: 'Adults only'}, READ.peer_decisions[1]],
    };
    render(<ConflictRulingForm read={withNote} busy={false} onRule={vi.fn()} />);
    const rowA = screen.getByText('Reviewer A').closest('li');
    const rowB = screen.getByText('Reviewer B').closest('li');
    expect(rowA).toHaveTextContent('Note: Adults only');
    expect(rowB).not.toHaveTextContent('Note:');
    expect(screen.getAllByText(/^Note:/)).toHaveLength(1);
    expect(screen.queryByText('Reviewer A Name')).toBeNull();
    expect(screen.queryByText('Reviewer B Name')).toBeNull();
  });

  it("adopts a reviewer's decision with every decision id ruled on", async () => {
    const user = userEvent.setup();
    const onRule = renderForm();
    await user.click(screen.getByRole('button', {name: "Use Reviewer B's decision"}));
    await vi.waitFor(() =>
      expect(onRule).toHaveBeenCalledWith({ruled_on_decision_ids: ['dA', 'dB'], selected_decision_id: 'dB'}),
    );
  });

  it('overrides with a reason and a trimmed note', async () => {
    const user = userEvent.setup();
    const onRule = renderForm();
    await user.type(screen.getByLabelText('Note for the record (optional)'), '  Out of scope  ');
    await user.click(screen.getByRole('button', {name: 'Decide differently'}));
    await user.click(screen.getByRole('button', {name: /Exclude with reason/}));
    await user.click(await screen.findByRole('button', {name: /Wrong population/}));
    await vi.waitFor(() =>
      expect(onRule).toHaveBeenCalledWith({
        ruled_on_decision_ids: ['dA', 'dB'],
        decision: 'exclude',
        exclusion_reason: 'Wrong population',
        rationale: 'Out of scope',
      }),
    );
  });

  it('disables while busy', async () => {
    const user = userEvent.setup();
    renderForm(true);
    expect(screen.getByRole('button', {name: "Use Reviewer A's decision"})).toBeDisabled();
    await user.click(screen.getByRole('button', {name: 'Decide differently'}));
    expect(screen.getByRole('button', {name: /Include/})).toBeDisabled();
  });
});
