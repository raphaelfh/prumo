import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { InstanceCard } from '@/components/extraction/InstanceCard';

/**
 * Icon-only buttons must expose their action as an accessible name
 * (aria-label + hover tooltip — `.claude/rules/frontend.md`). Runs
 * against the REAL copy module so the names below are the shipped ones.
 */

const instance = {
  id: 'i1',
  entity_type_id: 'et1',
  article_id: 'a',
  template_id: 't',
  label: 'Model A',
  metadata: {},
  created_at: '',
};

const baseProps = {
  instance: instance as never,
  index: 1,
  fields: [],
  values: {},
  onValueChange: vi.fn(),
  projectId: 'p',
};

describe('InstanceCard icon-button labels', () => {
  it('names the remove button after the instance label', () => {
    render(<InstanceCard {...baseProps} canRemove onRemove={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Remove "Model A"' }),
    ).toBeInTheDocument();
  });

  it('names the rename button after the instance label and opens the entry dialog', async () => {
    const user = userEvent.setup();
    render(
      <InstanceCard
        {...baseProps}
        canRemove={false}
        entryLabel="validation"
        keyLabel="Validation type"
        onRename={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Rename "Model A"' }));
    // The dialog edits the label AND the identity (re-key), each labelled.
    expect(screen.getByRole('heading', { name: /Rename validation/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Label/)).toHaveValue('Model A');
    expect(screen.getByLabelText(/Validation type/)).toBeInTheDocument();
  });

  it('offers no rename button without a rename handler', () => {
    render(<InstanceCard {...baseProps} canRemove={false} />);
    expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull();
  });
});
