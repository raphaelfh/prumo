/**
 * AISuggestionDisplay — the inline glance below a field.
 *
 * The backend records a "no information" outcome as a first-class proposal
 * carrying the coded marker ``{value:null, absent_reason:'no_information'}``
 * (ADR-0016). The service preserves that envelope as ``suggestion.value``, so the
 * inline strip renders a QUIET "No information found" indicator for it — never
 * the loud "(empty) · 0%" a real low-confidence suggestion gets — while still
 * exposing the one-click accept/reject actions (decision #3: an abstention is an
 * acceptable proposal; accepting activates the field's disposition). A real value
 * keeps its value + actions.
 *
 * A MARKERLESS abstention — a bare ``null`` with no ``absent_reason`` sibling —
 * is the shape the backend records when the field opts out of the marker
 * (``allows_no_information = false``, migration 0062: 94 of 95 PROBAST+AI fields)
 * or on an ``ambiguous`` verdict. It takes the same quiet strip under DIFFERENT
 * copy (there is no instrument answer to adopt), and an empty STRING stays a
 * genuine value on the loud branch so the two can never be confused.
 */

import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { AISuggestionDisplay } from './AISuggestionDisplay';
import type { AISuggestion, AISuggestionHistoryItem } from '@/types/ai-extraction';

// AISuggestionConfidence renders a Tooltip; the real app has a root provider.
const render = (ui: React.ReactElement) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>);

function makeSuggestion(over: Partial<AISuggestion>): AISuggestion {
  return {
    id: 'p1',
    runId: 'run-A',
    value: 'Retrospective cohort',
    confidence: 0.9,
    reasoning: '',
    status: 'pending',
    timestamp: new Date('2026-04-28T10:00:00Z'),
    ...over,
  };
}

const NO_INFO = { value: null, absent_reason: 'no_information' };

describe('AISuggestionDisplay — no-information handling', () => {
  it('renders a quiet "No information found" for a marker value, not "(empty) · 0%"', () => {
    render(<AISuggestionDisplay suggestion={makeSuggestion({ value: NO_INFO, confidence: 0 })} />);
    expect(screen.getByText('reviewNoInformation')).toBeInTheDocument();
    expect(screen.queryByText('(empty)')).not.toBeInTheDocument();
    // No misleading 0% confidence badge on a no-info card.
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('a not_applicable marker also renders the quiet no-info card', () => {
    render(
      <AISuggestionDisplay
        suggestion={makeSuggestion({
          value: { value: null, absent_reason: 'not_applicable' },
          confidence: 0,
        })}
      />,
    );
    expect(screen.getByText('reviewNoInformation')).toBeInTheDocument();
  });

  it('renders a real value with its confidence (regression)', () => {
    render(<AISuggestionDisplay suggestion={makeSuggestion({ value: 'Retrospective cohort', confidence: 0.9 })} />);
    expect(screen.getByText('Retrospective cohort')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.queryByText('reviewNoInformation')).not.toBeInTheDocument();
  });

  it('offers one-click accept/reject on the abstention strip (ADR-0016 decision #3)', async () => {
    // The abstention is a first-class acceptable proposal: accepting it writes
    // the marker into the form and activates the field's "No information"
    // disposition. Rendering stays quiet (no confidence badge) — only the
    // actions are exposed, exactly like a normal suggestion.
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const user = userEvent.setup();
    render(
      <AISuggestionDisplay
        suggestion={makeSuggestion({ value: NO_INFO, confidence: 0 })}
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(screen.getByText('reviewNoInformation')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'acceptSuggestion' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'rejectSuggestion' }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('an accepted abstention shows the accepted state on its accept action', () => {
    render(
      <AISuggestionDisplay
        suggestion={makeSuggestion({ value: NO_INFO, confidence: 0, status: 'accepted' })}
        onAccept={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'suggestionAccepted' })).toBeInTheDocument();
  });
});

describe('AISuggestionDisplay — markerless abstention (bare null, migration 0062)', () => {
  it('renders the quiet "No value proposed" strip, not "(empty) · 0%"', () => {
    // The backend drops the abstention confidence (null), which the read path
    // floors to 0 — so the loud branch printed "(empty)" beside a fabricated
    // "0%". PR #731 made this the routine outcome on every PROBAST+AI signaling
    // question, where the field opts out of the marker.
    render(<AISuggestionDisplay suggestion={makeSuggestion({ value: null, confidence: 0 })} />);
    expect(screen.getByText('reviewNoValue')).toBeInTheDocument();
    expect(screen.queryByText('(empty)')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    // And NOT the marker copy: "No information found" would read as the
    // instrument's fifth answer rather than as the model's silence — the
    // fabrication migration 0062 exists to prevent.
    expect(screen.queryByText('reviewNoInformation')).not.toBeInTheDocument();
  });

  it('a genuine empty-string extraction stays on the LOUD branch, with its confidence', () => {
    // The anti-regression for widening the quiet branch: '' is a value the
    // model extracted, so it must stay distinguishable from "proposed nothing".
    render(<AISuggestionDisplay suggestion={makeSuggestion({ value: '', confidence: 0.9 })} />);
    expect(screen.getByText('(empty)')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.queryByText('reviewNoValue')).not.toBeInTheDocument();
    expect(screen.queryByText('reviewNoInformation')).not.toBeInTheDocument();
  });

  it('keeps one-click accept/reject — accepting records WHY the field is blank', async () => {
    // The §IX trace worth keeping: "left empty *because* the model found
    // nothing", as against "nobody got to it". Accepting writes null, which the
    // autosave normalizes exactly like the '' it used to write.
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const user = userEvent.setup();
    render(
      <AISuggestionDisplay
        suggestion={makeSuggestion({ value: null, confidence: 0 })}
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'acceptSuggestion' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'rejectSuggestion' }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('spells out that an ACCEPTED markerless abstention leaves the field empty', () => {
    // frontend-ux §4.5: a recorded choice whose input still looks blank needs an
    // explicit hint — a bare ✓ over an empty field reads as lost work.
    render(
      <AISuggestionDisplay
        suggestion={makeSuggestion({ value: null, confidence: 0, status: 'accepted' })}
        onAccept={vi.fn()}
      />,
    );
    expect(screen.getByText('reviewNoValueRecorded')).toBeInTheDocument();
  });

  it('does not show the recorded hint while the proposal is still pending', () => {
    render(
      <AISuggestionDisplay
        suggestion={makeSuggestion({ value: null, confidence: 0 })}
        onAccept={vi.fn()}
      />,
    );
    expect(screen.queryByText('reviewNoValueRecorded')).not.toBeInTheDocument();
  });

  it('an ACCEPTED marker abstention keeps its own copy — the field reads as answered', () => {
    // The hint is specific to the markerless shape; the marker path activates
    // the field's "No information" disposition, so the input is not blank.
    render(
      <AISuggestionDisplay
        suggestion={makeSuggestion({ value: NO_INFO, confidence: 0, status: 'accepted' })}
        onAccept={vi.fn()}
      />,
    );
    expect(screen.queryByText('reviewNoValueRecorded')).not.toBeInTheDocument();
  });
});

describe('AISuggestionDisplay — review popover entry point', () => {
  const historyItem = (over: Partial<AISuggestionHistoryItem>): AISuggestionHistoryItem => ({
    id: 'p1',
    runId: 'run-A',
    value: 'Retrospective cohort',
    confidence: 0.9,
    reasoning: '',
    status: 'pending',
    timestamp: new Date('2026-04-28T10:00:00Z'),
    evidence: [],
    ...over,
  });

  it('opens the review popover from the inline value when a review binding is supplied', async () => {
    const getHistory = vi.fn(async () => [historyItem({})]);
    const user = userEvent.setup();
    render(
      <AISuggestionDisplay
        suggestion={makeSuggestion({ value: 'Retrospective cohort', confidence: 0.9 })}
        review={{ instanceId: 'i', fieldId: 'f', getHistory, selectedProposalId: 'p1', onSelect: vi.fn() }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'reviewOpenFromValue' }));
    expect(getHistory).toHaveBeenCalledWith('i', 'f');
  });

  it('opens the review popover from the no-information indicator too', async () => {
    const getHistory = vi.fn(async () => [] as AISuggestionHistoryItem[]);
    const user = userEvent.setup();
    render(
      <AISuggestionDisplay
        suggestion={makeSuggestion({ value: NO_INFO, confidence: 0 })}
        review={{ instanceId: 'i', fieldId: 'f', getHistory, onSelect: vi.fn() }}
      />,
    );
    expect(screen.getByText('reviewNoInformation')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'reviewOpenFromValue' }));
    expect(getHistory).toHaveBeenCalledWith('i', 'f');
  });

  it('renders no review trigger when no binding is supplied (backward compat)', () => {
    render(<AISuggestionDisplay suggestion={makeSuggestion({ value: 'X', confidence: 0.5 })} />);
    expect(screen.queryByRole('button', { name: 'reviewOpenFromValue' })).not.toBeInTheDocument();
  });
});

describe('AISuggestionDisplay — select option code → label', () => {
  const YES_NO = [
    { value: 'Y', label: 'Yes' },
    { value: 'N', label: 'No' },
  ];

  it('renders the human label for a coded select value', () => {
    render(
      <AISuggestionDisplay
        suggestion={makeSuggestion({ value: 'Y', confidence: 0.9 })}
        fieldType="select"
        allowedValues={YES_NO}
      />,
    );
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.queryByText('Y')).not.toBeInTheDocument();
  });

  it('falls back to the raw code when no field context is supplied', () => {
    render(<AISuggestionDisplay suggestion={makeSuggestion({ value: 'Y', confidence: 0.9 })} />);
    expect(screen.getByText('Y')).toBeInTheDocument();
  });
});
