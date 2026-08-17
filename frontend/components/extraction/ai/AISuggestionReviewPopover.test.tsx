import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// Template-preserving echo for the attribution keys so the `{{name}}`
// substitution (the core of D3) is actually exercised; everything else
// key-echoes as before.
vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) =>
    ((
      {
        reviewAdoptedBy: 'Adopted by {{name}}',
        reviewEditedBy: 'Edited by {{name}}',
        reviewRunBy: 'Run by {{name}}',
      } as Record<string, string>
    )[key] ?? key),
}));

import { AISuggestionReviewPopover } from './AISuggestionReviewPopover';
import { RunEditabilityProvider } from '@/components/runs/RunEditabilityContext';
import type { AISuggestionHistoryItem } from '@/types/ai-extraction';

function v(over: Partial<AISuggestionHistoryItem>): AISuggestionHistoryItem {
  return {
    id: 'p1',
    runId: 'run-A',
    value: 'Retrospective cohort',
    confidence: 0.9,
    reasoning: '',
    status: 'pending',
    timestamp: new Date('2026-04-28T10:00:00Z'),
    evidence: [],
    ...over,
  };
}

describe('AISuggestionReviewPopover', () => {
  it('lists versions; marks the selected; Use-this-version selects by id; marker → No information found', async () => {
    const history = [
      v({
        id: 'p2',
        value: { value: null, absent_reason: 'no_information' },
        timestamp: new Date('2026-04-28T11:00:00Z'),
      }),
      v({ id: 'p1', value: 'Retrospective cohort' }),
    ];
    const getHistory = vi.fn(async () => history);
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={getHistory}
        selectedProposalId="p1"
        onSelect={onSelect}
        onClear={vi.fn()}
        trigger={<button>open</button>}
      />,
    );

    await user.click(screen.getByText('open'));
    expect(getHistory).toHaveBeenCalledWith('i', 'f');

    // p1 is the selected version.
    await screen.findByText('reviewSelected');
    // p2 has a null value → renders the No information found card.
    expect(screen.getByText('reviewNoInformation')).toBeInTheDocument();

    // The only non-selected version (p2) exposes Use this version.
    const useBtn = screen.getByRole('button', { name: /reviewUseThisVersion/ });
    await user.click(useBtn);
    // Carries the chosen version's id, value, and its own confidence (0.9).
    // Selecting a no-info version propagates the full marker envelope to the form
    // (ADR-0016), not a bare null — the accepted form value round-trips as the marker.
    expect(onSelect).toHaveBeenCalledWith(
      'p2',
      { value: null, absent_reason: 'no_information' },
      0.9,
    );
  });

  it('Clear in the pinned footer calls onClear', async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();

    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => [v({})]}
        selectedProposalId="p1"
        onSelect={vi.fn()}
        onClear={onClear}
        trigger={<button>open</button>}
      />,
    );

    await user.click(screen.getByText('open'));
    const clearBtn = await screen.findByRole('button', { name: /reviewClear/ });
    await user.click(clearBtn);
    expect(onClear).toHaveBeenCalled();
  });
});

describe('AISuggestionReviewPopover — consensus reuse (D2/D3)', () => {
  it('renders no Use-this-version action when onSelect is absent', async () => {
    const user = userEvent.setup();
    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => [v({ id: 'p2' }), v({ id: 'p1' })]}
        selectedProposalId="p1"
        trigger={<button>open</button>}
      />,
    );
    await user.click(screen.getByText('open'));
    await screen.findAllByText('Retrospective cohort');
    expect(
      screen.queryByRole('button', { name: /reviewUseThisVersion/ }),
    ).not.toBeInTheDocument();
  });

  it('title override + adoption chip: equal value → Adopted by, edited → Edited by', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => [v({ id: 'p1', value: 'Retrospective cohort' })]}
        selectedProposalId="p1"
        title="AI used by Ana"
        adoption={{
          reviewerLabel: 'Ana',
          decisionValue: { value: 'Retrospective cohort' },
          decisionKind: 'edit',
        }}
        trigger={<button>open</button>}
      />,
    );
    await user.click(screen.getByText('open'));
    await screen.findByText('AI used by Ana');
    expect(screen.getByText('Adopted by Ana')).toBeInTheDocument();
    unmount();

    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => [v({ id: 'p1', value: 'Retrospective cohort' })]}
        selectedProposalId="p1"
        title="AI used by Ana"
        adoption={{
          reviewerLabel: 'Ana',
          decisionValue: { value: 'edited afterwards' },
          decisionKind: 'edit',
        }}
        trigger={<button>open</button>}
      />,
    );
    await user.click(screen.getByText('open'));
    expect(await screen.findByText('Edited by Ana')).toBeInTheDocument();
  });

  it('accept_proposal decisions (value=null by contract) always read Adopted by', async () => {
    const user = userEvent.setup();
    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => [v({ id: 'p1' })]}
        selectedProposalId="p1"
        adoption={{ reviewerLabel: 'Ana', decisionValue: null, decisionKind: 'accept_proposal' }}
        trigger={<button>open</button>}
      />,
    );
    await user.click(screen.getByText('open'));
    expect(await screen.findByText('Adopted by Ana')).toBeInTheDocument();
  });

  it('cross-marks split Adopted vs Edited per peer, keyed on the link (D6)', async () => {
    const user = userEvent.setup();
    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => [v({ id: 'p2', value: 'Retrospective cohort' }), v({ id: 'p1' })]}
        selectedProposalId="p1"
        adoptionByProposalId={{
          p2: [
            // accept_proposal (value=null) → Adopted, no value check
            { reviewerLabel: 'Bruno', decisionValue: null, decisionKind: 'accept_proposal' },
            // linked edit whose value DIFFERS from p2's value → Edited
            { reviewerLabel: 'Carla', decisionValue: { value: 'changed it' }, decisionKind: 'edit' },
          ],
        }}
        trigger={<button>open</button>}
      />,
    );
    await user.click(screen.getByText('open'));
    await screen.findAllByText('Retrospective cohort');
    expect(screen.getByText('Adopted by Bruno')).toBeInTheDocument();
    expect(screen.getByText('Edited by Carla')).toBeInTheDocument();
  });

  it('never fabricates "Edited by" when the linked version is outside the loaded window (D5)', async () => {
    const user = userEvent.setup();
    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => [v({ id: 'p-newer' })]}
        selectedProposalId="p-ancient"
        adoption={{ reviewerLabel: 'Ana', decisionValue: { value: 'stale edit' }, decisionKind: 'edit' }}
        trigger={<button>open</button>}
      />,
    );
    await user.click(screen.getByText('open'));
    await screen.findByText('Retrospective cohort');
    // The pin fell out of the loaded window → the "not in history" banner shows
    // and the attribution degrades to silent omission (fail-closed, spec D5) —
    // crucially, it is NEVER a fabricated "Edited by" from comparing against an
    // absent value. `adoptionWording(..., undefined) → 'adopted'` is unit-tested
    // in adoption.test.ts; here we guard the no-fabrication invariant.
    expect(screen.getByText('reviewPinNotInHistory')).toBeInTheDocument();
    expect(screen.queryByText('Edited by Ana')).not.toBeInTheDocument();
  });

  it('suppresses the newest-version "Selected" chip when pinNewestWhenNoSelection is false (D8)', async () => {
    const user = userEvent.setup();
    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => [v({ id: 'p2' }), v({ id: 'p1' })]}
        pinNewestWhenNoSelection={false}
        trigger={<button>open</button>}
      />,
    );
    await user.click(screen.getByText('open'));
    await screen.findAllByText('Retrospective cohort');
    // No explicit selection + suppression → nothing painted as "Selected".
    expect(screen.queryByText('reviewSelected')).not.toBeInTheDocument();
  });
});

describe('AISuggestionReviewPopover — verdict chip (Verified mode §5)', () => {
  it('renders each of the three verdicts beside the confidence badge', async () => {
    const user = userEvent.setup();
    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => [
          v({ id: 'p3', verification: { verdict: 'confirmed' } }),
          v({ id: 'p2', verification: { verdict: 'unsupported' } }),
          v({ id: 'p1', verification: { verdict: 'uncertain' } }),
        ]}
        selectedProposalId="p3"
        onSelect={vi.fn()}
        trigger={<button>open</button>}
      />,
    );
    await user.click(screen.getByText('open'));
    await screen.findAllByText('Retrospective cohort');
    expect(screen.getByText('verificationConfirmed')).toBeInTheDocument();
    expect(screen.getByText('verificationUnsupported')).toBeInTheDocument();
    expect(screen.getByText('verificationUncertain')).toBeInTheDocument();
  });

  it('renders no chip when the verification key is absent (unverified stays unambiguous)', async () => {
    const user = userEvent.setup();
    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => [v({ id: 'p1' })]}
        selectedProposalId="p1"
        onSelect={vi.fn()}
        trigger={<button>open</button>}
      />,
    );
    await user.click(screen.getByText('open'));
    await screen.findByText('Retrospective cohort');
    expect(screen.queryByText('verificationConfirmed')).not.toBeInTheDocument();
    expect(screen.queryByText('verificationUnsupported')).not.toBeInTheDocument();
    expect(screen.queryByText('verificationUncertain')).not.toBeInTheDocument();
  });
});

describe('AISuggestionReviewPopover — ran-by run headers (D3)', () => {
  const historyWithRanBy = [
    v({ id: 'p1', provenance: { ranByName: 'Carla' } }),
    v({ id: 'p0', runId: 'run-legacy', timestamp: new Date('2026-04-27T09:00:00Z') }),
  ];

  it('shows Run by {name} when the provider grants peer identity', async () => {
    const user = userEvent.setup();
    render(
      <RunEditabilityProvider stage="consensus" showPeerIdentity>
        <AISuggestionReviewPopover
          instanceId="i"
          fieldId="f"
          getHistory={async () => historyWithRanBy}
          selectedProposalId="p1"
          trigger={<button>open</button>}
        />
      </RunEditabilityProvider>,
    );
    await user.click(screen.getByText('open'));
    expect(await screen.findByText(/Run by Carla/)).toBeInTheDocument();
    // The legacy run group (no provenance) stays timestamp-only.
    expect(screen.getByText(/04\/27\/2026/)).toBeInTheDocument();
  });

  it('stays timestamp-only without the identity grant — including provider-less renders (fail-closed)', async () => {
    const user = userEvent.setup();
    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => historyWithRanBy}
        selectedProposalId="p1"
        onSelect={vi.fn()}
        trigger={<button>open</button>}
      />,
    );
    await user.click(screen.getByText('open'));
    await screen.findAllByText('Retrospective cohort');
    expect(screen.queryByText(/Run by Carla/)).not.toBeInTheDocument();
  });
});

describe('AISuggestionReviewPopover — pin not in loaded history (D5)', () => {
  it('shows an explicit notice instead of silently dropping the pin', async () => {
    const user = userEvent.setup();
    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => [v({ id: 'p-newer' })]}
        selectedProposalId="p-ancient"
        onSelect={vi.fn()}
        trigger={<button>open</button>}
      />,
    );

    await user.click(screen.getByText('open'));
    await screen.findByText('Retrospective cohort');
    expect(screen.getByText('reviewPinNotInHistory')).toBeInTheDocument();
  });

  it('shows no notice when the pinned version is loaded', async () => {
    const user = userEvent.setup();
    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => [v({ id: 'p1' })]}
        selectedProposalId="p1"
        onSelect={vi.fn()}
        trigger={<button>open</button>}
      />,
    );

    await user.click(screen.getByText('open'));
    await screen.findByText('Retrospective cohort');
    expect(screen.queryByText('reviewPinNotInHistory')).not.toBeInTheDocument();
  });
});

describe('AISuggestionReviewPopover — history load failure', () => {
  it('shows an inline error — never a definitive "No versions" (rate-limit honesty)', async () => {
    const user = userEvent.setup();
    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => {
          throw new Error('429 too many requests');
        }}
        onSelect={vi.fn()}
        trigger={<button>open</button>}
      />,
    );
    await user.click(screen.getByText('open'));
    expect(await screen.findByText('reviewHistoryError')).toBeInTheDocument();
    expect(screen.queryByText('reviewNoVersions')).not.toBeInTheDocument();
  });
});

describe('AISuggestionReviewPopover — read-only run', () => {
  it('hides Use-this-version and Clear (audit-only popover)', async () => {
    const user = userEvent.setup();
    render(
      <RunEditabilityProvider stage="finalized">
        <AISuggestionReviewPopover
          instanceId="i"
          fieldId="f"
          getHistory={async () => [v({ id: 'p2' })]}
          selectedProposalId="p1"
          onSelect={vi.fn()}
          onClear={vi.fn()}
          trigger={<button>open</button>}
        />
      </RunEditabilityProvider>,
    );

    await user.click(screen.getByText('open'));
    // Wait for the (non-selected) version card to load.
    await screen.findByText('Retrospective cohort');

    expect(
      screen.queryByRole('button', { name: /reviewUseThisVersion/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^reviewClear$/ }),
    ).not.toBeInTheDocument();
  });
});
