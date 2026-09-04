import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {AddEntryDialog, RenameEntryDialog} from './AddEntryDialog';

/**
 * Every repeating section is an entry group: these dialogs are what the
 * model container's dialog used to be, for any section. They run against the
 * REAL copy module — a broken `{{noun}}` / `{{key}}` interpolation would
 * silently ship the template string.
 */

describe('AddEntryDialog', () => {
  const base = {
    open: true,
    entryLabel: 'validation',
    keyLabel: 'Validation type',
    existingKeys: ['apparent', 'Internal'],
    onCancel: vi.fn(),
  };

  it('labels the input with the key field, names the noun, and lists the siblings', () => {
    render(<AddEntryDialog {...base} onConfirm={vi.fn()} />);
    expect(screen.getByRole('heading', {name: /Add new validation/})).toBeInTheDocument();
    expect(screen.getByLabelText(/Validation type/)).toBeInTheDocument();
    expect(screen.getByText('apparent')).toBeInTheDocument();
    expect(screen.getByText('Internal')).toBeInTheDocument();
    expect(screen.getByText(/finds this validation type updates this validation/)).toBeInTheDocument();
  });

  it('blocks an exact duplicate regardless of case and spacing, without confirming', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<AddEntryDialog {...base} onConfirm={onConfirm} />);
    await user.type(screen.getByLabelText(/Validation type/), '  internal ');
    await user.click(screen.getByRole('button', {name: /Create validation/}));
    expect(
      screen.getByText('A validation with this validation type already exists'),
    ).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms with the trimmed key value', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<AddEntryDialog {...base} onConfirm={onConfirm} />);
    await user.type(screen.getByLabelText(/Validation type/), ' external ');
    await user.click(screen.getByRole('button', {name: /Create validation/}));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('external'));
  });

  it('still works on a keyless section, as a plain label', () => {
    render(<AddEntryDialog {...base} keyLabel={null} existingKeys={[]} onConfirm={vi.fn()} />);
    expect(screen.getByLabelText(/^Label/)).toBeInTheDocument();
    expect(screen.queryByText(/Identity for AI re-runs/)).toBeNull();
  });

  it('shows a failed confirm as the dialog error and stays open', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue(new Error('boom'));
    render(<AddEntryDialog {...base} onConfirm={onConfirm} />);
    await user.type(screen.getByLabelText(/Validation type/), 'external');
    await user.click(screen.getByRole('button', {name: /Create validation/}));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});

describe('RenameEntryDialog', () => {
  const base = {
    open: true,
    entryLabel: 'model',
    keyLabel: 'Model name',
    initialLabel: 'Model 1',
    initialKey: 'XGBoost',
    siblingKeys: ['LightGBM'],
    onCancel: vi.fn(),
  };

  it('prefills the label and the identity separately', () => {
    render(<RenameEntryDialog {...base} onConfirm={vi.fn()} />);
    expect(screen.getByRole('heading', {name: /Rename model/})).toBeInTheDocument();
    expect(screen.getByLabelText(/^Label/)).toHaveValue('Model 1');
    expect(screen.getByLabelText(/Model name/)).toHaveValue('XGBoost');
  });

  it('confirms both changes, trimmed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<RenameEntryDialog {...base} onConfirm={onConfirm} />);
    const key = screen.getByLabelText(/Model name/);
    await user.clear(key);
    await user.type(key, ' Gradient Boosting ');
    await user.click(screen.getByRole('button', {name: 'Save'}));
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({label: 'Model 1', entityKey: 'Gradient Boosting'}),
    );
  });

  it('refuses to re-key onto a sibling identity', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<RenameEntryDialog {...base} onConfirm={onConfirm} />);
    const key = screen.getByLabelText(/Model name/);
    await user.clear(key);
    await user.type(key, 'lightgbm');
    await user.click(screen.getByRole('button', {name: 'Save'}));
    expect(screen.getByText('A model with this model name already exists')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('has no identity input on a keyless section and confirms a null key', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<RenameEntryDialog {...base} keyLabel={null} initialKey={null} onConfirm={onConfirm} />);
    expect(screen.queryByLabelText(/Model name/)).toBeNull();
    await user.click(screen.getByRole('button', {name: 'Save'}));
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({label: 'Model 1', entityKey: null}),
    );
  });
});
