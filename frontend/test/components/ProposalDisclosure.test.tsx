import {act, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {http, HttpResponse} from 'msw';
import {server} from '@/test/mocks/server';
import {AISuggestionService} from '@/services/aiSuggestionService';
import {ProposalDisclosure} from '@/components/extraction/review/ProposalDisclosure';
import {ProposalPreview} from '@/components/extraction/review/ProposalPreview';
import type {AISuggestion} from '@/types/ai-extraction';

vi.mock('@/integrations/supabase/client', () => ({supabase: {auth: {getSession: vi.fn(async () => ({data: {session: {access_token: 'test'}}}))}}}));
const locate = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/extraction/useReaderLocate', () => ({useReaderLocate: () => ({locate, isAvailable: true})}));
const older: AISuggestion = {id: 'old', runId: 'run', value: 'Equal value', confidence: 0.8, status: 'pending', timestamp: new Date('2026-09-01'), reasoning: 'First call reasoning', generationSnapshot: {model: 'first-model'}, evidence: [{text: 'First source', rank: 0, blockIds: [1], pageNumber: 1}]};
const newer: AISuggestion = {...older, id: 'new', timestamp: new Date('2026-09-02'), reasoning: 'Second call reasoning', generationSnapshot: {model: 'second-model'}, evidence: [{text: 'Second source', rank: 0, blockIds: [2], pageNumber: 2}, {text: 'Third source', rank: 1, blockIds: [3], pageNumber: 3}]};
const getHistory = vi.fn<() => Promise<AISuggestion[]>>();
const onToggle = vi.fn();
const base = {instanceId: 'instance', fieldId: 'field', getHistory, expanded: true, saving: false, onToggle, isAccepted: (p: AISuggestion) => p.id === 'old'};
beforeEach(() => {vi.clearAllMocks(); getHistory.mockResolvedValue([older, newer]);});

describe('inline proposal history', () => {
  it('uses the history API envelope without merging same-value calls or mutable run provenance', async () => {
    server.use(http.get('*/api/v1/articles/article/suggestions/history', ({request}) => {
      expect(new URL(request.url).searchParams.get('instance_id')).toBe('instance');
      return HttpResponse.json({ok: true, data: [older, newer].map(p => ({id: p.id, run_id: p.runId, proposed_value: {value: p.value}, created_at: p.timestamp.toISOString(), rationale: p.reasoning, generation_snapshot: {model: p.generationSnapshot?.model}, evidence: [], provenance: {model: 'mutable-run'}}))});
    }));
    const user = userEvent.setup();
    render(<ProposalDisclosure {...base} getHistory={(instanceId, fieldId) => AISuggestionService.getHistory('article', instanceId, fieldId)}/>);
    await screen.findByText('Second call reasoning');
    await user.click(screen.getByRole('button', {name: 'Compare extractions'}));
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByText('mutable-run')).not.toBeInTheDocument();
  });
  it('ignores an old coordinate response that arrives after navigation', async () => {
    let resolveOld!: (data: AISuggestion[]) => void;
    getHistory.mockImplementationOnce(() => new Promise(resolve => {resolveOld = resolve;}));
    const view = render(<ProposalDisclosure {...base}/>);
    await screen.findByRole('status');
    view.rerender(<ProposalDisclosure {...base} fieldId="different"/>);
    await screen.findByText('Second call reasoning');
    await act(async () => resolveOld([{...older, reasoning: 'Foreign coordinate'}]));
    expect(screen.queryByText('Foreign coordinate')).not.toBeInTheDocument();
  });
  it('opens the confirmed older version while the latest row check remains neutral', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    render(<><ProposalPreview latest={newer} count={2} expanded={false} onExpand={vi.fn()} accepted={false} onToggle={vi.fn()} acceptedOlder onOpenAccepted={open}/><ProposalDisclosure {...base} acceptedProposalId="old"/></>);
    await screen.findByRole('article');
    expect(screen.getAllByRole('button', {name: 'Accept extraction'})[0]).toHaveAttribute('aria-pressed', 'false');
    const indicators = screen.getAllByRole('button', {name: 'Open accepted extraction'});
    await user.click(indicators[0]); expect(open).toHaveBeenCalled();
    await user.click(indicators[1]);
    expect(screen.getByText('First call reasoning')).toBeVisible();
    expect(screen.getByRole('button', {name: 'Unaccept extraction'})).toHaveAttribute('aria-pressed', 'true');
  });
  // The check paints the click optimistically now (see AcceptCheck): the block
  // on further clicks is what this covers, not the absence of a painted state.
  it('blocks every acceptance action during a save without disabling it', async () => {
    const user = userEvent.setup();
    render(<ProposalDisclosure {...base} saving pendingProposalId="new" isAccepted={() => false}/>);
    await screen.findByRole('article');
    const check = screen.getByRole('button', {name: 'Unaccept extraction'});
    expect(check).not.toBeDisabled();
    expect(check).toHaveAttribute('aria-disabled', 'true');
    expect(check).toHaveAttribute('aria-busy', 'true');
    expect(check).toHaveAttribute('aria-pressed', 'true');
    await user.click(check);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('keeps equal-valued calls separate, newest first, and restores carousel selection after comparing', async () => {
    const user = userEvent.setup();
    render(<ProposalDisclosure {...base} />);
    expect(await screen.findByText('Second call reasoning')).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    await user.click(screen.getByRole('button', {name: 'Next extraction'}));
    expect(screen.getByText('First call reasoning')).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Compare extractions'}));
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getAllByText('first-model').some(el => !el.closest('[hidden]'))).toBe(true);
    expect(screen.getAllByText('second-model').some(el => !el.closest('[hidden]'))).toBe(true);
    await user.click(screen.getByRole('button', {name: 'Show one extraction'}));
    expect(screen.getByText('First call reasoning')).toBeVisible();
    expect(screen.getByRole('button', {name: 'Unaccept extraction'})).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', {name: 'Unaccept extraction'}));
    expect(onToggle).toHaveBeenCalledWith(older);
  });
  it('locates every ranked source through the reader path without closing on unavailable anchors', async () => {
    const user = userEvent.setup();
    render(<ProposalDisclosure {...base} />);
    const card = await screen.findByRole('article');
    const actions = within(card).getAllByRole('button', {name: 'Locate in document'});
    expect(actions).toHaveLength(2);
    await user.click(actions[0]); await user.click(actions[1]);
    expect(locate.mock.calls).toEqual([['Second source', 2, [2]], ['Third source', 3, [3]]]);
    expect(card).toBeVisible();
  });
  it('shows explicit legacy details and never fetches current article as historical text', async () => {
    getHistory.mockResolvedValue([{...older, generationSnapshot: undefined, provenance: {model: 'current-run'}}]);
    const user = userEvent.setup(); render(<ProposalDisclosure {...base} readOnly />);
    await screen.findByRole('article');
    expect(screen.queryByRole('button', {name: /accept extraction/i})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'How this was generated'}));
    expect(screen.getByText('Generation details were not recorded for this extraction.')).toBeVisible();
    expect(screen.queryByText('current-run')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /view text sent/i})).not.toBeInTheDocument();
  });
  it('renders only captured prompt facts and labels original input unavailable despite a current-file reference', async () => {
    getHistory.mockResolvedValue([{...older, generationSnapshot: {model: 'captured-model', promptComposition: {systemPrompt: 'Captured system instruction', articleRef: {currentFileId: 'current-file', fileName: 'source.pdf', historicalInputAvailable: false}}}}]);
    const user = userEvent.setup();
    render(<ProposalDisclosure {...base}/>);
    await screen.findByRole('article');
    await user.click(screen.getByRole('button', {name: 'How this was generated'}));
    expect(screen.getByText('Captured system instruction')).toBeVisible();
    expect(screen.getByText('Original input text is unavailable for this extraction.')).toBeVisible();
    expect(screen.queryByRole('button', {name: /view text sent/i})).not.toBeInTheDocument();
    expect(screen.queryByText('current-file')).not.toBeInTheDocument();
  });
  it('distinguishes initial loading/failure from refresh failure and retains loaded cards', async () => {
    let reject!: (reason: Error) => void;
    getHistory.mockImplementationOnce(() => new Promise((_, r) => {reject = r;}));
    const user = userEvent.setup(); const view = render(<ProposalDisclosure {...base} latestProposalId="new"/>);
    expect(await screen.findByRole('status')).toHaveTextContent('Loading extractions');
    await act(async () => reject(new Error('offline')));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load');
    await user.click(screen.getByRole('button', {name: 'Retry'}));
    await screen.findByText('Second call reasoning');
    expect(screen.queryByRole('button', {name: /refresh/i})).not.toBeInTheDocument();
    // A new extraction landing reloads the history in place.
    getHistory.mockRejectedValueOnce(new Error('offline'));
    view.rerender(<ProposalDisclosure {...base} latestProposalId="newest"/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh');
    expect(screen.getByText('Second call reasoning')).toBeVisible();
  });
  it('keeps mounted card state and external editor focus on controlled collapse', async () => {
    const user = userEvent.setup();
    const view = render(<><input aria-label="Editor"/><ProposalDisclosure {...base}/></>);
    await screen.findByRole('article');
    await user.click(screen.getByRole('button', {name: 'Next extraction'}));
    await user.click(screen.getByRole('textbox'));
    view.rerender(<><input aria-label="Editor"/><ProposalDisclosure {...base} expanded={false}/></>);
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(screen.getByText('First call reasoning')).not.toBeVisible();
    view.rerender(<><input aria-label="Editor"/><ProposalDisclosure {...base}/></>);
    expect(screen.getByText('First call reasoning')).toBeVisible();
  });
  // Side-by-side is a working habit, not a per-row choice: the coordinate key
  // remounts this component on every question, so without a remembered
  // preference the reviewer re-clicked Compare on every single one.
  it('carries the compare layout to the next question, and an accepted-version jump still opens single', async () => {
    const user = userEvent.setup();
    const view = render(<ProposalDisclosure {...base}/>);
    await screen.findByRole('article');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    await user.click(screen.getByRole('button', {name: 'Compare extractions'}));
    expect(screen.getAllByRole('article')).toHaveLength(2);

    view.rerender(<ProposalDisclosure {...base} fieldId="next-question"/>);
    await screen.findByText('Second call reasoning');
    expect(screen.getAllByRole('article')).toHaveLength(2);

    // Opening straight onto one proposal is a request for THAT one.
    view.rerender(<ProposalDisclosure {...base} fieldId="third" initialProposalId="old"/>);
    await screen.findByText('First call reasoning');
    expect(screen.getAllByRole('article')).toHaveLength(1);

    // ...and it does not rewrite the preference for the question after it.
    view.rerender(<ProposalDisclosure {...base} fieldId="fourth"/>);
    await screen.findByText('Second call reasoning');
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });
  // The path the coordinate-remount test above does NOT cover, and the one the
  // real table actually takes: a visited row keeps its disclosure MOUNTED and
  // only hides it, so a preference read once at mount would be stuck at
  // whatever it was the first time that question was opened.
  it('picks up a preference set elsewhere when a mounted row is re-opened', async () => {
    const user = userEvent.setup();
    const view = render(<ProposalDisclosure {...base}/>);
    await screen.findByRole('article');
    expect(screen.getAllByRole('article')).toHaveLength(1);

    // The reviewer turns compare on somewhere else in the table while this
    // row is closed; this component never unmounts.
    view.rerender(<ProposalDisclosure {...base} expanded={false}/>);
    localStorage.setItem('prumo.pref.review.compareProposals', 'true');
    view.rerender(<ProposalDisclosure {...base}/>);

    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByRole('button', {name: 'Show one extraction'})).toHaveAttribute('aria-pressed', 'true');

    // ...and the same in reverse, so turning it off propagates too.
    view.rerender(<ProposalDisclosure {...base} expanded={false}/>);
    localStorage.setItem('prumo.pref.review.compareProposals', 'false');
    view.rerender(<ProposalDisclosure {...base}/>);
    expect(screen.getAllByRole('article')).toHaveLength(1);

    // Toggling from inside this row still writes the preference for the rest.
    await user.click(screen.getByRole('button', {name: 'Compare extractions'}));
    expect(localStorage.getItem('prumo.pref.review.compareProposals')).toBe('true');
  });
  it('fails closed on a candidate acceptance id when typed equality is false', async () => {
    render(<ProposalDisclosure {...base} acceptedProposalId="old" isAccepted={() => false}/>);
    await screen.findByRole('article');
    expect(screen.getByRole('button', {name: 'Accept extraction'})).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', {name: 'Open accepted extraction'})).not.toBeInTheDocument();
  });
});

describe('complete proposal preview', () => {
  it('exposes full text by hover, keyboard and disclosure, and only counts multiple proposals', async () => {
    const user = userEvent.setup(); const onExpand = vi.fn();
    const latest = {...newer, value: 'A complete value '.repeat(30)};
    const view = render(<ProposalPreview latest={latest} count={1} expanded={false} onExpand={onExpand}/>);
    const preview = screen.getByRole('button', {name: latest.value.trim()});
    expect(screen.queryByText('1')).not.toBeInTheDocument();
    await user.hover(preview);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(latest.value.trim());
    await user.unhover(preview); await user.click(document.body); await user.tab();
    expect(preview).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(latest.value.trim());
    await user.keyboard('{Enter}'); expect(onExpand).toHaveBeenCalled();
    view.rerender(<ProposalPreview latest={latest} count={2} expanded onExpand={onExpand}/>);
    expect(screen.getByText('2')).toBeVisible();
    expect(preview).toHaveAttribute('aria-expanded', 'true');
  });
});
