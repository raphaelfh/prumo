/**
 * EntrySelector — tabs, and the UX rules the old dropdown did not meet.
 *
 * Runs against the REAL copy module, not a key-echoing `t` mock: a broken
 * `{{noun}}` interpolation falls back to the template string silently, and a
 * mocked `t` can never catch that. This file therefore also carries the noun
 * guard ported from `hierarchy/entryLabelNoun.test.tsx`.
 *
 * Four of the five controls violated `.claude/rules/frontend.md` § UI & copy
 * before this rewrite (missing tooltips, missing aria-labels, `hidden` where
 * the rule requires `sr-only`). Those are asserted here so a future edit
 * cannot quietly reintroduce them.
 */
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {EntrySelector} from './EntrySelector';

const ENTRIES = [
  {instanceId: 'm1', entryName: 'Cox Model', progress: {completed: 2, total: 4, percentage: 50}},
  {instanceId: 'm2', entryName: 'XGBoost', progress: {completed: 4, total: 4, percentage: 100}},
];

function base(overrides: Record<string, unknown> = {}) {
  return {
    entries: ENTRIES,
    activeEntryId: 'm1',
    onSelectEntry: vi.fn(),
    onAddEntry: vi.fn(),
    onRemoveEntry: vi.fn(),
    onRenameEntry: vi.fn(),
    ...overrides,
  };
}

describe('EntrySelector — tab contract', () => {
  it('renders one tab per entry with the active one selected', () => {
    render(<EntrySelector {...base()} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((el) => el.textContent)).toEqual([
      expect.stringContaining('Cox Model'),
      expect.stringContaining('XGBoost'),
    ]);
    expect(screen.getByRole('tab', {name: /Cox Model/})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', {name: /XGBoost/})).toHaveAttribute('aria-selected', 'false');
  });

  it('selects an entry by keyboard, not only by click', async () => {
    const onSelectEntry = vi.fn();
    render(<EntrySelector {...base({onSelectEntry})} />);

    await userEvent.click(screen.getByRole('tab', {name: /Cox Model/}));
    await userEvent.keyboard('{ArrowRight}');

    // A roving tabindex is what makes a tablist keyboard-navigable; a
    // dropdown had this for free and a hand-rolled strip would not.
    expect(onSelectEntry).toHaveBeenCalledWith('m2');
  });

  it('shows an empty state instead of an empty tablist', () => {
    render(<EntrySelector {...base({entries: [], activeEntryId: null})} entryLabel="model" />);

    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByText('No model added yet')).toBeInTheDocument();
  });
});

describe('EntrySelector — accessible names (rules § UI & copy)', () => {
  it('gives every control a non-empty accessible name', () => {
    render(<EntrySelector {...base({onIdentifyEntries: vi.fn(), onExtractAllSections: vi.fn()})} />);

    const named = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(name.trim()).not.toBe('');
  });

  it('folds the Add label to sr-only, never hidden', () => {
    render(<EntrySelector {...base()} entryLabel="model" />);
    const add = screen.getByRole('button', {name: /Add new model manually/i});
    const label = within(add).getByText('New');

    // Asserted on the CLASS, deliberately. The rule exists because `hidden`
    // removes the word from the accessibility tree — but jsdom loads no
    // Tailwind, so `display:none` never applies and the accessible name is
    // identical either way. A `getByRole`-based version of this test passes
    // with `hidden` substituted in (verified by mutation), so it would be
    // theatre. The visual half is covered by /design-review, not here.
    expect(label).toHaveClass('sr-only');
    expect(label).not.toHaveClass('hidden');
  });

  it('keeps the title attribute alongside the tooltip', () => {
    // Two Spec A e2e locators match on `title`; dropping it for a Tooltip
    // would break them silently.
    render(<EntrySelector {...base()} entryLabel="model" />);
    expect(screen.getByTitle('Add new model manually')).toBeInTheDocument();
    expect(screen.getByTitle('Rename active model')).toBeInTheDocument();
    expect(screen.getByTitle('Remove active model')).toBeInTheDocument();
  });
});

describe('EntrySelector — noun interpolation (ported B-8 D6 guard)', () => {
  it('threads a non-"model" noun end to end', () => {
    render(<EntrySelector {...base()} entryLabel="scenario" />);

    expect(screen.getByTitle('Rename active scenario')).toBeInTheDocument();
    expect(screen.getByTitle('Remove active scenario')).toBeInTheDocument();
    expect(screen.getByTitle('Add new scenario manually')).toBeInTheDocument();
  });

  it('renders an outer and a nested noun at the same time', () => {
    // A single-noun test cannot catch a nested section that reads its
    // PARENT's entry_label — the failure mode recursion introduces.
    render(
      <>
        <EntrySelector {...base()} entryLabel="model" />
        <EntrySelector
          {...base({entries: [{instanceId: 'p1', entryName: 'Age'}], activeEntryId: 'p1'})}
          entryLabel="predictor"
        />
      </>,
    );

    expect(screen.getByTitle('Rename active model')).toBeInTheDocument();
    expect(screen.getByTitle('Rename active predictor')).toBeInTheDocument();
  });

  it('falls back to the generic noun, never "model"', () => {
    render(<EntrySelector {...base({entries: [], activeEntryId: null})} />);
    expect(screen.getByText('No entry added yet')).toBeInTheDocument();
  });
});

describe('EntrySelector — bulk selection (trees B7)', () => {
  it('the Select toggle turns the tab strip into checkboxes', async () => {
    // Not always-on checkboxes: the common case is one entry, and a
    // permanent checkbox column reads as a table the reviewer must act on.
    render(<EntrySelector {...base({onDeleteEntries: vi.fn()})} />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', {name: /select/i}));

    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('deletes exactly the checked entries, and only after a confirmation', async () => {
    const onDeleteEntries = vi.fn();
    render(<EntrySelector {...base({onDeleteEntries})} />);
    await userEvent.click(screen.getByRole('button', {name: /select/i}));

    await userEvent.click(screen.getAllByRole('checkbox')[1]);
    await userEvent.click(screen.getByRole('button', {name: /delete/i}));

    // The confirmation is the last stop before a cascade — no dialog, no call.
    expect(onDeleteEntries).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', {name: /^delete$/i}));

    expect(onDeleteEntries).toHaveBeenCalledWith(['m2']);
  });

  it('the delete control is inert while nothing is checked', async () => {
    render(<EntrySelector {...base({onDeleteEntries: vi.fn()})} />);
    await userEvent.click(screen.getByRole('button', {name: /select/i}));

    expect(screen.getByRole('button', {name: /delete/i})).toBeDisabled();
  });

  it('leaving selection mode drops the selection', async () => {
    // Otherwise a stale tick survives out of sight and the next Select opens
    // with rows already armed for deletion.
    const onDeleteEntries = vi.fn();
    render(<EntrySelector {...base({onDeleteEntries})} />);
    await userEvent.click(screen.getByRole('button', {name: /select/i}));
    await userEvent.click(screen.getAllByRole('checkbox')[0]);
    await userEvent.click(screen.getByRole('button', {name: /cancel/i}));
    await userEvent.click(screen.getByRole('button', {name: /select/i}));

    expect(screen.getByRole('button', {name: /delete/i})).toBeDisabled();
  });

  it('offers no bulk affordance at all when the surface is read-only', async () => {
    render(<EntrySelector {...base({onDeleteEntries: vi.fn(), readOnly: true})} />);
    expect(screen.queryByRole('button', {name: /select/i})).toBeNull();
  });

  it('offers no bulk affordance when the caller is not a manager', async () => {
    // The endpoint gates on `is_project_manager` to match the RLS policy on
    // extraction_instances, so a reviewer must not be shown a control that
    // would always 403. The page passes `onDeleteEntries: undefined` for
    // anyone but a manager, and that absence has to hide the whole thing.
    render(<EntrySelector {...base()} />);
    expect(screen.queryByRole('button', {name: /select/i})).toBeNull();
  });
});
