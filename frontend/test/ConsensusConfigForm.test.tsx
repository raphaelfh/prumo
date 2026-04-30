/**
 * Behaviour tests for ConsensusConfigForm.
 *
 * The form is purely controlled — the parent owns persistence — so these
 * tests assert: rule transitions, arbitrator visibility, eligibility
 * filtering (only `consensus`/`manager` members surface in the picker),
 * and the empty-state message when no eligible member exists.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConsensusConfigForm } from '@/components/project/settings/ConsensusConfigForm';
import type { ProjectMemberSummary } from '@/hooks/hitl/useProjectMembers';
import type { HitlConfigPayload } from '@/services/hitlConfigService';

const MEMBERS: ProjectMemberSummary[] = [
  {
    user_id: 'user-mgr',
    role: 'manager',
    user_email: 'mgr@example.com',
    user_full_name: 'Maria Manager',
    user_avatar_url: null,
  },
  {
    user_id: 'user-rev',
    role: 'reviewer',
    user_email: 'rev@example.com',
    user_full_name: 'Roger Reviewer',
    user_avatar_url: null,
  },
  {
    user_id: 'user-cons',
    role: 'consensus',
    user_email: 'cons@example.com',
    user_full_name: 'Cassandra Consensus',
    user_avatar_url: null,
  },
];

function setup(value: HitlConfigPayload, members = MEMBERS) {
  const onChange = vi.fn();
  render(
    <ConsensusConfigForm value={value} onChange={onChange} members={members} />,
  );
  return { onChange };
}

describe('ConsensusConfigForm', () => {
  it('hides the arbitrator picker for non-arbitrator rules', () => {
    setup({
      reviewer_count: 1,
      consensus_rule: 'unanimous',
      arbitrator_id: null,
    });
    // The arbitrator label is only mounted when the rule requires one.
    expect(screen.queryByText(/^Arbitrator$/)).toBeNull();
  });

  it('drops the arbitrator id when switching away from arbitrator', () => {
    const { onChange } = setup({
      reviewer_count: 2,
      consensus_rule: 'arbitrator',
      arbitrator_id: 'user-cons',
    });

    // Find the rule select trigger (the second combobox).
    const triggers = screen.getAllByRole('combobox');
    const ruleTrigger = triggers[0];
    fireEvent.click(ruleTrigger);
    // Wait for option then click "Majority"
    const majorityOption = screen.getByText(
      /Majority — most-voted decision wins/i,
    );
    fireEvent.click(majorityOption);

    expect(onChange).toHaveBeenCalledWith({
      reviewer_count: 2,
      consensus_rule: 'majority',
      arbitrator_id: null,
    });
  });

  it('clamps reviewer_count to the configured max', () => {
    const { onChange } = setup({
      reviewer_count: 1,
      consensus_rule: 'unanimous',
      arbitrator_id: null,
    });
    const input = screen.getByLabelText(
      /Reviewers per article/i,
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '999' } });
    expect(onChange).toHaveBeenCalledWith({
      reviewer_count: 20, // default max
      consensus_rule: 'unanimous',
      arbitrator_id: null,
    });
  });

  it('shows the no-eligible-members hint when no manager/consensus exists', () => {
    setup(
      {
        reviewer_count: 1,
        consensus_rule: 'arbitrator',
        arbitrator_id: null,
      },
      [
        // Only a reviewer — not eligible.
        {
          user_id: 'user-rev',
          role: 'reviewer',
          user_email: 'rev@example.com',
          user_full_name: 'Roger Reviewer',
          user_avatar_url: null,
        },
      ],
    );
    expect(
      screen.getByText(/No eligible arbitrator/i),
    ).toBeInTheDocument();
  });
});
