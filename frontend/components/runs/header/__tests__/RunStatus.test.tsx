import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunHeader } from '@/components/runs/header';
import { makeRunHeaderValue } from './_headerTestUtils';
import type { RunHeaderValue } from '../RunHeaderContext';

vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const base = makeRunHeaderValue({
  role: 'reviewer',
  isBlind: true,
  progress: { completed: 3, total: 30, pct: 10 },
  reviewers: { count: 2, required: 2, divergent: 0 },
});

function renderStatus(value: Partial<RunHeaderValue>, props?: { open?: boolean; onOpenChange?: (o: boolean) => void }) {
  return render(
    <RunHeader value={{ ...base, ...value }}>
      <RunHeader.Center>
        <RunHeader.RunStatus {...props} />
      </RunHeader.Center>
    </RunHeader>,
  );
}

describe('RunStatus chip', () => {
  it('shows the kind-aware current stage with the e2e testid', () => {
    renderStatus({ stage: 'extract' });
    const chip = screen.getByTestId('run-stage-current');
    expect(chip).toHaveTextContent('stageExtract');
    expect(chip).toHaveAttribute('data-stage', 'extract');
  });
  it('QA runs label the extract stage as Assessment', () => {
    renderStatus({ kind: 'qa', stage: 'extract' });
    expect(screen.getByTestId('run-stage-current')).toHaveTextContent('stageAssessment');
  });
  it('pending is its own muted state, never Extraction', () => {
    renderStatus({ stage: null });
    const chip = screen.getByTestId('run-stage-current');
    expect(chip).toHaveTextContent('stagePending');
    expect(chip).toHaveAttribute('data-stage', 'pending');
  });
  it('finalized reads Finalized (e2e text contract)', () => {
    renderStatus({ stage: 'finalized' });
    expect(screen.getByTestId('run-stage-current')).toHaveTextContent('stageFinalized');
  });
});

describe('RunStatus popover', () => {
  it('opens from the chip: timeline + progress + reviewers + role', async () => {
    renderStatus({ stage: 'extract' });
    await userEvent.click(screen.getByTestId('run-stage-current'));
    const pop = await screen.findByTestId('run-status-popover');
    expect(pop).toHaveTextContent('stageExplainExtract');
    expect(pop).toHaveTextContent('statusRequiredFields');
    expect(pop).toHaveTextContent('reviewersOfExpected');
    expect(pop).toHaveTextContent('statusYouReviewAs');
  });
  it('arbitrator voice + divergence View for managers', async () => {
    const onJump = vi.fn();
    renderStatus({ role: 'manager', isBlind: false, reviewers: { count: 2, required: 2, divergent: 3 }, onJumpToDivergence: onJump });
    await userEvent.click(screen.getByTestId('run-stage-current'));
    const pop = await screen.findByTestId('run-status-popover');
    expect(pop).toHaveTextContent('stageExplainExtractArbiter');
    await userEvent.click(screen.getByRole('button', { name: 'statusViewDivergence' }));
    expect(onJump).toHaveBeenCalledOnce();
  });
  it('reviewers never see divergence rows or the amber dot', async () => {
    renderStatus({ role: 'reviewer', reviewers: { count: 2, required: 2, divergent: 3 } });
    expect(screen.queryByTestId('run-status-divergent')).toBeNull();
    await userEvent.click(screen.getByTestId('run-stage-current'));
    const pop = await screen.findByTestId('run-status-popover');
    expect(pop).not.toHaveTextContent('reviewersDiffer');
  });
  it('avatar button opens the same popover; amber dot for arbitrators', async () => {
    renderStatus({ role: 'consensus', isBlind: false, reviewers: { count: 3, required: 2, divergent: 1 } });
    expect(screen.getByTestId('run-status-divergent')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('run-status-reviewers'));
    expect(await screen.findByTestId('run-status-popover')).toBeInTheDocument();
  });
  it('no avatars when there are no reviewers', () => {
    renderStatus({ reviewers: { count: 0, required: 0, divergent: 0 } });
    expect(screen.queryByTestId('run-status-reviewers')).toBeNull();
  });
  it('hides the progress row when there is no per-field completeness (QA)', async () => {
    renderStatus({ kind: 'qa', progress: { completed: 0, total: 0, pct: 0 } });
    await userEvent.click(screen.getByTestId('run-stage-current'));
    expect(await screen.findByTestId('run-status-popover')).not.toHaveTextContent('statusRequiredFields');
  });
  it('ready hint renders when provided', async () => {
    renderStatus({ reviewers: { count: 2, required: 2, divergent: 0, ready: 1, readyTotal: 2 } });
    await userEvent.click(screen.getByTestId('run-stage-current'));
    expect(await screen.findByTestId('run-status-popover')).toHaveTextContent('reviewersReadyHint');
  });
  it('blind reveal + explainer live in the popover when canReveal', async () => {
    const onReveal = vi.fn();
    renderStatus({ role: 'manager', isBlind: true, canReveal: true, onReveal });
    await userEvent.click(screen.getByTestId('run-stage-current'));
    expect(await screen.findByTestId('run-status-popover')).toHaveTextContent('blindExplainer');
    await userEvent.click(await screen.findByRole('button', { name: 'reveal' }));
    expect(onReveal).toHaveBeenCalledOnce();
  });
  it('revision note renders when isRevision', async () => {
    renderStatus({ isRevision: true });
    await userEvent.click(screen.getByTestId('run-stage-current'));
    expect(await screen.findByTestId('run-status-popover')).toHaveTextContent('statusRevisionNote');
  });
  it('finalized explainer bridges to the published banner vocabulary', async () => {
    renderStatus({ stage: 'finalized' });
    await userEvent.click(screen.getByTestId('run-stage-current'));
    expect(await screen.findByTestId('run-status-popover')).toHaveTextContent('stageExplainFinalized');
  });
  it('controlled mode: open prop drives visibility, changes route through onOpenChange', async () => {
    const onOpenChange = vi.fn();
    renderStatus({}, { open: true, onOpenChange });
    expect(await screen.findByTestId('run-status-popover')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
