/**
 * DeleteFieldConfirm — folded-in impact pre-fetch (B-5 Task 7).
 *
 * The dialog owns its validation fetch through the `onValidate` prop,
 * replacing the third copy of the pre-fetch that lived in its hosts.
 * The result is ADVISORY: a
 * blocked validation explains the impact up front, but the DB's 23503
 * refusal (mapped in the service) is the real invariant.
 */
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

import type {ExtractionField, FieldValidationResult} from '@/types/extraction';

import {DeleteFieldConfirm} from './DeleteFieldConfirm';

const FIELD = {
  id: 'f1',
  entity_type_id: 'sec',
  name: 'weight',
  label: 'Weight',
  description: null,
  field_type: 'number',
  is_required: false,
  sort_order: 1,
} as unknown as ExtractionField;

const validation = (canDelete: boolean): FieldValidationResult => ({
  canDelete,
  canUpdate: true,
  canChangeType: canDelete,
  extractedValuesCount: canDelete ? 0 : 3,
  affectedArticles: canDelete ? [] : ['a1'],
  message: canDelete ? 'safe' : 'in-use',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DeleteFieldConfirm — onValidate flow', () => {
  it('fetches the impact through onValidate and shows the confirm action when deletable', async () => {
    const onValidate = vi.fn(async () => validation(true));
    render(
      <DeleteFieldConfirm
        field={FIELD}
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn(async () => true)}
        onValidate={onValidate}
      />,
    );

    expect(
      await screen.findByRole('button', {name: /deleteField/}),
    ).toBeInTheDocument();
    // The fetch is microtask-deferred, so assert after the awaited query.
    expect(onValidate).toHaveBeenCalledWith('f1');
    expect(screen.getByText('confirmDeleteTitle')).toBeInTheDocument();
  });

  it('renders the cannot-delete branch without a confirm action when blocked', async () => {
    render(
      <DeleteFieldConfirm
        field={FIELD}
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn(async () => true)}
        onValidate={vi.fn(async () => validation(false))}
      />,
    );

    expect(await screen.findByText('cannotDelete')).toBeInTheDocument();
    expect(screen.getByText('impossibleToDelete')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /deleteField/})).toBeNull();
  });

  it('confirm resolves through onConfirm and closes on success', async () => {
    const onConfirm = vi.fn(async () => true);
    const onOpenChange = vi.fn();
    render(
      <DeleteFieldConfirm
        field={FIELD}
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        onValidate={vi.fn(async () => validation(true))}
      />,
    );

    await userEvent.click(await screen.findByRole('button', {name: /deleteField/}));

    expect(onConfirm).toHaveBeenCalledWith('f1');
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('stays open when onConfirm reports failure', async () => {
    const onOpenChange = vi.fn();
    render(
      <DeleteFieldConfirm
        field={FIELD}
        open
        onOpenChange={onOpenChange}
        onConfirm={vi.fn(async () => false)}
        onValidate={vi.fn(async () => validation(true))}
      />,
    );

    await userEvent.click(await screen.findByRole('button', {name: /deleteField/}));

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
