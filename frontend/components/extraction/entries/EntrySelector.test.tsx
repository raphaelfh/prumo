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
