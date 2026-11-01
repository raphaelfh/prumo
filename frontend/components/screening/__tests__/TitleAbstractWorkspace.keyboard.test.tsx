/**
 * TitleAbstractWorkspace — keyboard triage, the Esc order, auto-advance and
 * next-record prefetch. Shared fixtures: ./titleAbstractWorkspace.fixtures.
 */
import {fireEvent, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http} from 'msw';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));
vi.mock('sonner', () => ({toast: Object.assign(vi.fn(), {success: vi.fn(), error: vi.fn()})}));

import {toast} from 'sonner';

import type {ScreeningRecordRow} from '@/services/screeningService';
import {server} from '@/test/mocks/server';

import {
  ALPHA,
  ARBITRATE_URL,
  assignmentFor,
  BETA,
  config,
  DECIDE_URL,
  GAMMA,
  liveRegion,
  MANAGER,
  ok,
  panel,
  renderWorkspace,
  row,
  search,
  serveAssignments,
  serveRecords,
  titleButton,
} from './titleAbstractWorkspace.fixtures';

beforeEach(() => {
  vi.mocked(toast).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('TitleAbstractWorkspace — keyboard', () => {
  const press = (key: string, target: Element = document.body) => fireEvent.keyDown(target, {key});
  const cursorTitle = () => document.querySelector('[data-cursor="true"]')?.querySelector('button:not([role="checkbox"])')?.textContent ?? null;
  const box = (title: string) => screen.getByRole('checkbox', {name: `Select ${title}`});

  // Manager → the All view: Alpha, Beta, Gamma in queue order.
  const renderAll = (path?: string) => {
    serveRecords([ALPHA, BETA, GAMMA]);
    serveAssignments([ALPHA, BETA, GAMMA]);
    return renderWorkspace({cfg: config(MANAGER), path});
  };

  it('j and k move the cursor; the panel follows when open', async () => {
    renderAll();
    await screen.findByRole('button', {name: 'Alpha trial'});
    expect(cursorTitle()).toBeNull();

    press('j');
    expect(cursorTitle()).toBe('Alpha trial');
    press('j');
    expect(cursorTitle()).toBe('Beta cohort');
    press('k');
    expect(cursorTitle()).toBe('Alpha trial');
    // Closed panel: the cursor moves alone, nothing is selected.
    expect(search().has('article')).toBe(false);
    expect(panel()).toBeNull();

    press('Enter');
    expect(await screen.findByRole('heading', {name: 'Alpha trial'})).toBeInTheDocument();
    press('j');
    await waitFor(() => expect(search().get('article')).toBe('art2'));
    expect(await screen.findByRole('heading', {name: 'Beta cohort'})).toBeInTheDocument();
    expect(cursorTitle()).toBe('Beta cohort');
  });

  it('arrow keys move the cursor too', async () => {
    renderAll();
    await screen.findByRole('button', {name: 'Alpha trial'});
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown');
    expect(cursorTitle()).toBe('Gamma review');
    // The last row holds the cursor.
    press('ArrowDown');
    expect(cursorTitle()).toBe('Gamma review');
    press('ArrowUp');
    expect(cursorTitle()).toBe('Beta cohort');
  });

  it('Enter opens the cursor row', async () => {
    renderAll();
    await screen.findByRole('button', {name: 'Alpha trial'});
    press('j');
    press('j');
    press('Enter');
    expect(search().get('article')).toBe('art2');
    expect(await screen.findByRole('heading', {name: 'Beta cohort'})).toBeInTheDocument();
    expect(panel()).not.toBeNull();
  });

  it('keys are inert in a text field', async () => {
    renderAll();
    await screen.findByRole('button', {name: 'Alpha trial'});
    const searchBox = screen.getByPlaceholderText('Search records…');
    searchBox.focus();
    press('j', searchBox);
    press('x', searchBox);
    expect(cursorTitle()).toBeNull();
    // Precondition: the same key outside the field moves the cursor.
    press('j');
    expect(cursorTitle()).toBe('Alpha trial');
  });

  it('keys are inert under a dialog', async () => {
    const user = userEvent.setup();
    renderAll('/projects/p1?tab=screening&article=art1');
    await screen.findByRole('heading', {name: 'Alpha trial'});
    let decides = 0;
    server.use(
      http.post(DECIDE_URL, () => {
        decides += 1;
        return ok(assignmentFor(ALPHA));
      }),
    );
    await user.click(screen.getByRole('button', {name: 'Import from PubMed'}));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    press('j');
    press('1');
    press('x');
    expect(search().get('article')).toBe('art1');
    expect(cursorTitle()).toBe('Alpha trial');
    expect(decides).toBe(0);
  });

  it('x toggles the cursor row', async () => {
    renderAll();
    await screen.findByRole('button', {name: 'Alpha trial'});
    press('j');
    press('j');
    press('x');
    expect(box('Beta cohort')).toBeChecked();
    expect(box('Alpha trial')).not.toBeChecked();
    press('x');
    expect(box('Beta cohort')).not.toBeChecked();
  });

  it('shift-click selects a range', async () => {
    const user = userEvent.setup();
    renderAll();
    await screen.findByRole('button', {name: 'Alpha trial'});
    await user.click(box('Alpha trial'));
    await user.keyboard('{Shift>}');
    await user.click(box('Gamma review'));
    await user.keyboard('{/Shift}');
    expect(box('Alpha trial')).toBeChecked();
    expect(box('Beta cohort')).toBeChecked();
    expect(box('Gamma review')).toBeChecked();
  });

  it('Esc order: popover, maximize, panel, selection, checked rows — one step per press', async () => {
    const user = userEvent.setup();
    renderAll('/projects/p1?tab=screening&article=art1');
    await screen.findByRole('heading', {name: 'Alpha trial'});
    await user.click(box('Beta cohort'));
    fireEvent.keyDown(window, {key: '|', code: 'Backslash', ctrlKey: true, metaKey: true, shiftKey: true});
    expect(document.querySelector('[data-maximized="true"]')).not.toBeNull();
    press('f');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    const escape = () => fireEvent.keyDown(document.activeElement ?? document.body, {key: 'Escape'});
    escape();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.querySelector('[data-maximized="true"]')).not.toBeNull();
    // Focus returns to the filter trigger, whose tooltip opens: the tooltip
    // takes its own Escape, which is not a chain step.
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();
    escape();
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    expect(document.querySelector('[data-maximized="true"]')).not.toBeNull();

    escape();
    expect(document.querySelector('[data-maximized]')).toBeNull();
    expect(panel()).not.toBeNull();

    escape();
    expect(panel()).toBeNull();
    expect(search().get('article')).toBe('art1');

    escape();
    await waitFor(() => expect(search().has('article')).toBe(false));
    expect(box('Beta cohort')).toBeChecked();

    escape();
    await waitFor(() => expect(box('Beta cohort')).not.toBeChecked());
  });

  it('? opens the shortcuts popover from the toolbar and Esc closes only it', async () => {
    const user = userEvent.setup();
    renderAll('/projects/p1?tab=screening&article=art1');
    await screen.findByRole('heading', {name: 'Alpha trial'});
    // The list stays mounted but hidden while maximized: hold the checkbox node.
    const betaBox = box('Beta cohort');
    await user.click(betaBox);
    // The help button sits in the toolbar row, beside the other toolbar actions.
    const toolbarRow = screen.getByRole('button', {name: 'Import from PubMed'}).parentElement!;
    expect(within(toolbarRow).getByRole('button', {name: 'Keyboard shortcuts'})).toBeInTheDocument();
    // Maximized, the list (and its toolbar) is hidden, yet `?` still opens the popover.
    fireEvent.keyDown(window, {key: '|', code: 'Backslash', ctrlKey: true, metaKey: true, shiftKey: true});
    expect(document.querySelector('[data-maximized="true"]')).not.toBeNull();

    fireEvent.keyDown(window, {key: '?', code: 'Slash', shiftKey: true});
    expect(await screen.findByRole('dialog', {name: 'Keyboard shortcuts'})).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement ?? document.body, {key: 'Escape'});
    await waitFor(() => expect(screen.queryByRole('dialog', {name: 'Keyboard shortcuts'})).toBeNull());
    expect(document.querySelector('[data-maximized="true"]')).not.toBeNull();
    expect(panel()).not.toBeNull();
    expect(search().get('article')).toBe('art1');
    expect(screen.getByRole('heading', {name: 'Alpha trial'})).toBeInTheDocument();
    expect(betaBox).toBeChecked();
  });

  it('Esc in the search field clears nothing', async () => {
    const user = userEvent.setup();
    renderAll('/projects/p1?tab=screening&article=art1');
    await screen.findByRole('heading', {name: 'Alpha trial'});
    await user.click(box('Beta cohort'));
    const searchBox = screen.getByPlaceholderText('Search records…');
    searchBox.focus();
    press('Escape', searchBox);
    expect(panel()).not.toBeNull();
    expect(search().get('article')).toBe('art1');
    expect(box('Beta cohort')).toBeChecked();
  });
});

describe('TitleAbstractWorkspace — auto-advance', () => {
  const DELTA = row({article_id: 'art4', assignment_id: 'a4', queue_rank: 4, title: 'Delta study'});
  const EPSILON = row({article_id: 'art5', assignment_id: 'a5', queue_rank: 5, title: 'Epsilon series'});
  const ZETA = row({article_id: 'art6', assignment_id: 'a6', queue_rank: 6, title: 'Zeta report'});

  function serveDecide(current: {rows: ScreeningRecordRow[]}, decided: ScreeningRecordRow) {
    server.use(
      http.post(DECIDE_URL, () => {
        current.rows = current.rows.map((r) =>
          r.article_id === decided.article_id
            ? {...r, status: 'included', my_decision: 'include', outcome: 'include'}
            : r,
        );
        return ok({...assignmentFor(decided), status: 'decided'});
      }),
    );
  }

  it('auto-advances to the next To screen in queue order after a decision', async () => {
    // Beta sits before Alpha in the payload; Gamma (decided) is skipped.
    const current = serveRecords([{...BETA, queue_rank: 3}, GAMMA, {...ALPHA, queue_rank: 1}, DELTA]);
    serveAssignments(current.rows);
    serveDecide(current, ALPHA);
    const user = userEvent.setup();
    renderWorkspace({path: '/projects/p1?tab=screening&article=art1'});
    await screen.findByRole('heading', {name: 'Alpha trial'});

    await user.click(await screen.findByRole('button', {name: /Include/}));

    await waitFor(() => expect(search().get('article')).toBe('art2'));
    expect(await screen.findByRole('heading', {name: 'Beta cohort'})).toBeInTheDocument();
    // After the refetch the decided row is still listed in To screen, with its new chip.
    expect(screen.getByRole('tab', {name: /^To screen/})).toHaveAttribute('aria-selected', 'true');
    await waitFor(() =>
      expect(within(titleButton('Alpha trial')!.closest('tr')!).getByText('Included')).toBeInTheDocument(),
    );
  });

  it('announces the next record', async () => {
    const current = serveRecords([ALPHA, BETA]);
    serveAssignments(current.rows);
    serveDecide(current, ALPHA);
    const user = userEvent.setup();
    renderWorkspace({path: '/projects/p1?tab=screening&article=art1'});
    await screen.findByRole('heading', {name: 'Alpha trial'});
    const live = liveRegion();
    expect(live).toHaveTextContent('');

    await user.click(await screen.findByRole('button', {name: /Include/}));

    await waitFor(() => expect(live).toHaveTextContent('Next record: Beta cohort'));
  });

  it('prefetches the next two assignments', async () => {
    const current = serveRecords([ALPHA, BETA, DELTA, EPSILON, ZETA]);
    const calls = serveAssignments(current.rows);
    serveDecide(current, ALPHA);
    const user = userEvent.setup();
    renderWorkspace({path: '/projects/p1?tab=screening&article=art1'});
    await screen.findByRole('heading', {name: 'Alpha trial'});
    expect(calls.ids).not.toContain('a4');

    await user.click(await screen.findByRole('button', {name: /Include/}));

    await waitFor(() => expect(search().get('article')).toBe('art2'));
    // Beta is open (its own read); Delta and Epsilon wait in the cache, Zeta does not.
    await waitFor(() => expect(calls.ids).toEqual(expect.arrayContaining(['a2', 'a4', 'a5'])));
    expect(calls.ids).not.toContain('a6');
    expect(search().get('article')).toBe('art2');
  });

  it('prefetches the next two in wrapped queue order at the end of the queue', async () => {
    const current = serveRecords([ALPHA, BETA, DELTA, EPSILON, ZETA]);
    const calls = serveAssignments(current.rows);
    serveDecide(current, EPSILON);
    const user = userEvent.setup();
    renderWorkspace({path: '/projects/p1?tab=screening&article=art5'});
    await screen.findByRole('heading', {name: 'Epsilon series'});
    expect(calls.ids).not.toContain('a1');

    await user.click(await screen.findByRole('button', {name: /Include/}));

    // Zeta is the last To screen: the two after it wrap to Alpha and Beta, as nextToScreen does.
    await waitFor(() => expect(search().get('article')).toBe('art6'));
    await waitFor(() => expect(calls.ids).toEqual(expect.arrayContaining(['a6', 'a1', 'a2'])));
    expect(calls.ids).not.toContain('a4');
  });

  // Spec §4.4 advances after a To screen decision only: a solo re-decide of a
  // decided record stays on it, and its chip follows the new outcome.
  it('stays on the record after a solo re-decide', async () => {
    const DECIDED = {...ALPHA, status: 'included' as const, my_decision: 'include' as const, outcome: 'include' as const};
    const current = serveRecords([DECIDED, BETA]);
    serveAssignments(current.rows, (r) =>
      r.article_id === DECIDED.article_id
        ? {
            ...assignmentFor(r),
            status: 'decided',
            my_decision: {id: 'd1', decision: 'include', exclusion_reason: null, rationale: null, created_at: '2026-10-23T00:00:00Z'},
            outcome: {decision: 'include', exclusion_reason: null, kind: 'solo', reasons_differ: false},
          }
        : assignmentFor(r),
    );
    let decisions = 0;
    server.use(
      http.post(DECIDE_URL, () => {
        decisions += 1;
        current.rows = current.rows.map((r) =>
          r.article_id === DECIDED.article_id ? {...r, status: 'excluded', my_decision: 'exclude', outcome: 'exclude'} : r,
        );
        return ok({...assignmentFor(DECIDED), status: 'decided'});
      }),
    );
    const user = userEvent.setup();
    renderWorkspace({cfg: config({reviewer_count: 1}), path: '/projects/p1?tab=screening&status=all&article=art1'});
    expect(await screen.findByRole('button', {name: /Include/})).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', {name: /^Exclude(?! with)/}));

    await waitFor(() => expect(decisions).toBe(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Changed to Exclude'));
    await waitFor(() =>
      expect(within(titleButton('Alpha trial')!.closest('tr')!).getByText('Excluded')).toBeInTheDocument(),
    );
    expect(search().get('article')).toBe('art1');
    expect(screen.getByRole('heading', {name: 'Alpha trial'})).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('');
  });

  it('stays on the decided record when nothing is left to screen', async () => {
    const current = serveRecords([ALPHA, GAMMA]);
    serveAssignments(current.rows);
    serveDecide(current, ALPHA);
    const user = userEvent.setup();
    renderWorkspace({path: '/projects/p1?tab=screening&article=art1'});
    await screen.findByRole('heading', {name: 'Alpha trial'});

    await user.click(await screen.findByRole('button', {name: /Include/}));

    await waitFor(() =>
      expect(within(titleButton('Alpha trial')!.closest('tr')!).getByText('Included')).toBeInTheDocument(),
    );
    expect(search().get('article')).toBe('art1');
    expect(screen.getByRole('heading', {name: 'Alpha trial'})).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('');
  });

  // Spec §4.4 advances after a To screen decision only: a ruling keeps the
  // arbitrator on the ruled record, which then reads as arbitrated.
  it('keeps the panel on a ruled record', async () => {
    const CONFLICT = row({article_id: 'art7', assignment_id: 'a7', queue_rank: 7, title: 'Eta trial', status: 'conflict'});
    serveRecords([ALPHA, CONFLICT]);
    const peer = (id: string, decision: 'include' | 'exclude') => ({
      id,
      reviewer_id: `r-${id}`,
      reviewer_name: `Name ${id}`,
      decision,
      exclusion_reason: null,
      rationale: null,
      created_at: '2026-10-01T10:00:00Z',
    });
    serveAssignments([ALPHA, CONFLICT], (r) =>
      r === CONFLICT
        ? {...assignmentFor(r), status: 'conflict', peer_decisions: [peer('dA', 'include'), peer('dB', 'exclude')]}
        : assignmentFor(r),
    );
    let rulings = 0;
    server.use(
      http.post(ARBITRATE_URL, () => {
        rulings += 1;
        return ok({...assignmentFor(CONFLICT), status: 'decided'});
      }),
    );
    const user = userEvent.setup();
    renderWorkspace({cfg: config(MANAGER), path: '/projects/p1?tab=screening&article=art7'});
    await screen.findByRole('heading', {name: 'Eta trial'});

    await user.click(await screen.findByRole('button', {name: "Use Reviewer A's decision"}));

    await waitFor(() => expect(rulings).toBe(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Conflict resolved'));
    expect(search().get('article')).toBe('art7');
    expect(liveRegion()).toHaveTextContent('');
  });
});
