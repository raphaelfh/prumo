import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => (key === 'optionLabelEditNamed' ? 'Edit {{label}}' : key),
}));

import type {OptionItem} from '@/lib/extraction/options';

import {AllowedValuesList} from './AllowedValuesList';

const COHORT_RCT: OptionItem[] = [
  {value: 'coh', label: 'Cohort'},
  {value: 'rct', label: 'RCT'},
];

function renderList(options: OptionItem[], showReorder = true) {
  const onChange = vi.fn();
  render(
    <AllowedValuesList options={options} onChange={onChange} showReorder={showReorder} />,
  );
  return {onChange};
}

const addInput = () => screen.getByPlaceholderText('placeholderOptions');
const editInput = () => screen.getByRole('textbox', {name: 'optionLabelEdit'});
const labelButton = (label: string) => screen.getByRole('button', {name: `Edit ${label}`});

describe('AllowedValuesList', () => {
  it('renames an option inline and keeps its stored value', async () => {
    const user = userEvent.setup();
    const {onChange} = renderList([{value: 'coh', label: 'Cohort'}]);

    await user.click(labelButton('Cohort'));
    await user.clear(editInput());
    await user.type(editInput(), 'Cohort study{Enter}');

    expect(onChange).toHaveBeenLastCalledWith([{value: 'coh', label: 'Cohort study'}]);
  });

  it('renames inside the plain (non-reorder) list too', async () => {
    const user = userEvent.setup();
    const {onChange} = renderList([{value: 'coh', label: 'Cohort'}], false);

    await user.click(labelButton('Cohort'));
    await user.clear(editInput());
    await user.type(editInput(), 'Cohort study');
    await user.tab();

    expect(onChange).toHaveBeenLastCalledWith([{value: 'coh', label: 'Cohort study'}]);
  });

  it('names each label button after its own option', () => {
    renderList(COHORT_RCT);

    expect(labelButton('Cohort')).toBeInTheDocument();
    expect(labelButton('RCT')).toBeInTheDocument();
  });

  it('returns focus to the label button after Enter commits', async () => {
    const user = userEvent.setup();
    renderList([{value: 'coh', label: 'Cohort'}]);

    await user.click(labelButton('Cohort'));
    await user.clear(editInput());
    await user.type(editInput(), 'Cohort study{Enter}');

    expect(labelButton('Cohort')).toHaveFocus();
  });

  it('returns focus to the label button after Escape cancels', async () => {
    const user = userEvent.setup();
    renderList(COHORT_RCT);

    await user.click(labelButton('RCT'));
    await user.keyboard('{Escape}');

    expect(labelButton('RCT')).toHaveFocus();
  });

  it('gives a new option its trimmed label as the value', async () => {
    const user = userEvent.setup();
    const {onChange} = renderList([{value: 'coh', label: 'Cohort'}]);

    await user.type(addInput(), '  RCT  {Enter}');

    expect(onChange).toHaveBeenLastCalledWith([
      {value: 'coh', label: 'Cohort'},
      {value: 'RCT', label: 'RCT'},
    ]);
  });

  it('refuses to add a label equal to an existing label', async () => {
    const user = userEvent.setup();
    const {onChange} = renderList(COHORT_RCT);

    await user.type(addInput(), 'Cohort{Enter}');

    expect(screen.getByText('valueAlreadyAdded')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses to add a label equal to an existing value', async () => {
    const user = userEvent.setup();
    const {onChange} = renderList(COHORT_RCT);

    await user.type(addInput(), 'rct{Enter}');

    expect(screen.getByText('valueAlreadyAdded')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("refuses a rename to another option's value", async () => {
    const user = userEvent.setup();
    const {onChange} = renderList(COHORT_RCT);

    await user.click(screen.getByText('RCT'));
    await user.clear(editInput());
    await user.type(editInput(), 'coh{Enter}');

    expect(screen.getByText('valueAlreadyAdded')).toBeInTheDocument();
    expect(editInput()).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps an emptied inline edit open with enterValue', async () => {
    const user = userEvent.setup();
    const {onChange} = renderList(COHORT_RCT);

    await user.click(screen.getByText('Cohort'));
    await user.clear(editInput());
    await user.keyboard('{Enter}');

    expect(screen.getByText('enterValue')).toBeInTheDocument();
    expect(editInput()).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('cancels an inline edit on Escape', async () => {
    const user = userEvent.setup();
    const {onChange} = renderList(COHORT_RCT);

    await user.click(screen.getByText('Cohort'));
    await user.clear(editInput());
    await user.type(editInput(), 'Something else{Escape}');

    expect(screen.queryByRole('textbox', {name: 'optionLabelEdit'})).toBeNull();
    expect(screen.getByText('Cohort')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes an option by its remove button', async () => {
    const user = userEvent.setup();
    const {onChange} = renderList(COHORT_RCT);

    await user.click(screen.getAllByRole('button', {name: 'optionRemove'})[0]);

    expect(onChange).toHaveBeenLastCalledWith([{value: 'rct', label: 'RCT'}]);
  });
});
