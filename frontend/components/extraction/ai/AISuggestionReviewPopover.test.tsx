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

  it('a MARKERLESS null version reads "No value proposed" with NO confidence badge', async () => {
    // Migration 0062: on a field that opts out of the marker the abstention is
    // recorded bare (`{value: null}`, confidence null). Without this the row
    // rendered an EMPTY title beside a fabricated "0% · low".
    const user = userEvent.setup();
    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => [v({ id: 'p2', value: null, confidence: 0 })]}
        selectedProposalId="p2"
        onSelect={vi.fn()}
        trigger={<button>open</button>}
      />,
    );

    await user.click(screen.getByText('open'));
    expect(await screen.findByText('reviewNoValue')).toBeInTheDocument();
    expect(screen.getByText('reviewNoValueDesc')).toBeInTheDocument();
    // Not the marker copy — there is no recorded "No information" answer here.
    expect(screen.queryByText('reviewNoInformation')).not.toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
  });

  it('a genuine empty-string version keeps its confidence badge (not an abstention)', async () => {
    const user = userEvent.setup();
    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => [v({ id: 'p2', value: '', confidence: 0.9 })]}
        selectedProposalId="p2"
        onSelect={vi.fn()}
        trigger={<button>open</button>}
      />,
    );

    await user.click(screen.getByText('open'));
    expect(await screen.findByText('90%')).toBeInTheDocument();
    expect(screen.queryByText('reviewNoValue')).not.toBeInTheDocument();
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

  it('keeps the audit note on Clear’s tooltip instead of a footer row', async () => {
    const user = userEvent.setup();
    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => [v({})]}
        selectedProposalId="p1"
        onSelect={vi.fn()}
        onClear={vi.fn()}
        trigger={<button>open</button>}
      />,
    );

    await user.click(screen.getByText('open'));
    const clearBtn = await screen.findByRole('button', { name: /reviewClear/ });
    expect(screen.queryByText('reviewClearHint')).not.toBeInTheDocument();
    await user.hover(clearBtn);
    expect((await screen.findAllByText('reviewClearHint')).length).toBeGreaterThan(0);
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
  // Runner identity is attempt-owned: the backend resolves it onto the call's
  // generation snapshot only after the run reveals peers (spec §12.2). A legacy
  // attempt-less row never names a runner — not even from stale provenance.
  const historyWithRanBy = [
    v({ id: 'p1', extractionAttemptId: 'attempt-1', generationSnapshot: { model: 'm', ranByName: 'Carla' }, provenance: { model: 'm' } }),
    v({ id: 'p0', runId: 'run-legacy', timestamp: new Date('2026-04-27T09:00:00Z'), provenance: { ranByName: 'Legacy runner' } }),
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
    // The legacy run group (no attempt, no snapshot) stays timestamp-only.
    expect(screen.getByText(/04\/27\/2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Run by Legacy runner/)).not.toBeInTheDocument();
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

  // Any project member can own an attempt on the same live run, so one run group
  // can hold versions by different runners. A header naming the newest owner
  // would attribute the older versions to the wrong person (constitution §IX).
  const mixedOwnerRun = [
    v({ id: 'p-bruno', value: 'Cohort B', extractionAttemptId: 'attempt-2', generationSnapshot: { ranByName: 'Bruno' }, timestamp: new Date('2026-04-28T11:00:00Z') }),
    v({ id: 'p-ana', value: 'Cohort A', extractionAttemptId: 'attempt-1', generationSnapshot: { ranByName: 'Ana' } }),
    v({ id: 'p-legacy', value: 'Cohort L', timestamp: new Date('2026-04-28T09:00:00Z') }),
  ];

  /** The nearest ancestor of `el` that holds a version value — its version row. */
  function versionRowOf(el: HTMLElement): HTMLElement {
    let node: HTMLElement | null = el;
    while (node && !/Cohort [ABL]/.test(node.textContent ?? '')) node = node.parentElement;
    if (!node) throw new Error('label is not inside a version row');
    return node;
  }

  it('a mixed-owner run names each version by its own runner, never one header for all', async () => {
    const user = userEvent.setup();
    render(
      <RunEditabilityProvider stage="consensus" showPeerIdentity>
        <AISuggestionReviewPopover
          instanceId="i"
          fieldId="f"
          getHistory={async () => mixedOwnerRun}
          selectedProposalId="p-ana"
          trigger={<button>open</button>}
        />
      </RunEditabilityProvider>,
    );
    await user.click(screen.getByText('open'));
    await screen.findByText('Cohort A');

    // No run header speaks for the group: a header carries the run timestamp.
    expect(screen.queryByText(/Run by \w+ · /)).not.toBeInTheDocument();

    const anaRow = versionRowOf(screen.getByText('Run by Ana'));
    expect(anaRow).toHaveTextContent('Cohort A');
    expect(anaRow).not.toHaveTextContent(/Cohort [BL]/);

    const brunoRow = versionRowOf(screen.getByText('Run by Bruno'));
    expect(brunoRow).toHaveTextContent('Cohort B');
    expect(brunoRow).not.toHaveTextContent(/Cohort [AL]/);

    // The attempt-less version names nobody.
    expect(screen.getAllByText(/Run by/)).toHaveLength(2);
  });

  it('a mixed-owner run names no runner without the identity grant', async () => {
    const user = userEvent.setup();
    render(
      <RunEditabilityProvider stage="consensus">
        <AISuggestionReviewPopover
          instanceId="i"
          fieldId="f"
          getHistory={async () => mixedOwnerRun}
          selectedProposalId="p-ana"
          trigger={<button>open</button>}
        />
      </RunEditabilityProvider>,
    );
    await user.click(screen.getByText('open'));
    await screen.findByText('Cohort A');
    expect(screen.queryByText(/Ana|Bruno/)).not.toBeInTheDocument();
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

describe('AISuggestionReviewPopover — per-version engine (contract)', () => {
  // CHARACTERIZATION, not coverage of the backend slice: this component already
  // read `version.provenance` per row, so the test passes with the backend
  // change reverted. It pins the contract the backend now depends on — a
  // refactor that hoists the model to the run-group header must fail here.
  //
  // Two versions of ONE coordinate, produced on the SAME run by different
  // engines. Until per-proposal provenance the run held a single, last-write-
  // wins snapshot, so both rows necessarily rendered the same model.
  const historyWithDistinctEngines = [
    v({
      id: 'p2',
      value: 412,
      extractionAttemptId: 'attempt-2',
      generationSnapshot: {ranByName: 'Carla', model: 'claude-5-opus'},
      provenance: {model: 'claude-5-opus'},
      timestamp: new Date('2026-04-28T11:00:00Z'),
    }),
    v({
      id: 'p1',
      value: 'Retrospective cohort',
      extractionAttemptId: 'attempt-1',
      generationSnapshot: {ranByName: 'Carla', model: 'gpt-5.6-luna'},
      provenance: {model: 'gpt-5.6-luna'},
    }),
  ];

  it('renders each version with the engine that produced it', async () => {
    const user = userEvent.setup();
    render(
      <RunEditabilityProvider stage="consensus" showPeerIdentity>
        <AISuggestionReviewPopover
          instanceId="i"
          fieldId="f"
          getHistory={async () => historyWithDistinctEngines}
          selectedProposalId="p1"
          trigger={<button>open</button>}
        />
      </RunEditabilityProvider>,
    );
    await user.click(screen.getByText('open'));

    // The pinned version shows its own engine without any interaction.
    expect(await screen.findByText(/gpt-5\.6-luna/)).toBeInTheDocument();

    // The other version, once expanded, shows a DIFFERENT engine — the whole
    // point: the group no longer speaks for every row in it.
    // Only the non-selected row renders a Details toggle.
    await user.click(screen.getByRole('button', {name: /reviewDetails|details/i}));
    expect(await screen.findByText(/claude-5-opus/)).toBeInTheDocument();

    // One runner owns both versions: the group header names them once, and no
    // row repeats it.
    expect(screen.getAllByText(/Run by Carla/)).toHaveLength(1);
    expect(screen.getByText(/Run by Carla · /)).toBeInTheDocument();
  });
});
