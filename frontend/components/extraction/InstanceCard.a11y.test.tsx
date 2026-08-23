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

  it('names the save and cancel buttons in label-edit mode', async () => {
    const user = userEvent.setup();
    render(<InstanceCard {...baseProps} canRemove={false} />);
    await user.click(screen.getByRole('button', { name: /Model A/ }));
    expect(
      screen.getByRole('button', { name: 'Save label' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Cancel label editing' }),
    ).toBeInTheDocument();
  });
});
