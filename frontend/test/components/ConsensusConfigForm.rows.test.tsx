/** ConsensusConfigForm as a fragment of SettingsRows (spec 2026-09-13 §4.3, §10). */
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {ConsensusConfigForm} from '@/components/project/settings/ConsensusConfigForm';
import type {ProjectMemberSummary} from '@/hooks/hitl/useProjectMembers';
import {consensus} from '@/lib/copy/consensus';
import type {HitlConfigPayload} from '@/services/hitlConfigService';

const MANAGER: ProjectMemberSummary = {
  user_id: 'm1', role: 'manager', user_email: 'm@x.org', user_full_name: 'Maria', user_avatar_url: null,
};
const ARBITRATOR_RULE: HitlConfigPayload = {reviewer_count: 1, consensus_rule: 'arbitrator', arbitrator_id: null};

/** The text of every element the control's aria-describedby points at. */
const describedTexts = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);

describe('ConsensusConfigForm — settings rows', () => {
  it('returns rows with no wrapper element', () => {
    const {container} = render(
      <ConsensusConfigForm value={{...ARBITRATOR_RULE, consensus_rule: 'unanimous'}} onChange={vi.fn()} members={[MANAGER]} />,
    );
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toHaveClass('grid');
  });

  it('describes the rule trigger by its hint and a missing arbitrator by the row error', () => {
    render(<ConsensusConfigForm value={ARBITRATOR_RULE} onChange={vi.fn()} members={[MANAGER]} />);
    const [rule, arbitrator] = screen.getAllByRole('combobox');
    expect(rule).toHaveClass('border-transparent');
    expect(describedTexts(rule)).toEqual([consensus.ruleHint]);
    expect(describedTexts(arbitrator)).toEqual([consensus.arbitratorHint, consensus.arbitratorRequired]);
    expect(screen.getByText(consensus.arbitratorRequired)).toHaveClass('text-destructive');
  });

  it('keeps control ids unique, each named by its own label, when two forms mount at once', () => {
    render(
      <>
        <ConsensusConfigForm value={ARBITRATOR_RULE} onChange={vi.fn()} members={[MANAGER]} />
        <ConsensusConfigForm value={ARBITRATOR_RULE} onChange={vi.fn()} members={[MANAGER]} />
      </>,
    );
    const controls = screen.getAllByRole('combobox');
    expect(controls).toHaveLength(4);
    expect(new Set(controls.map((el) => el.id)).size).toBe(4);
    const labels = Array.from(document.querySelectorAll('label'));
    controls.forEach((el) => expect(labels.filter((label) => label.htmlFor === el.id)).toHaveLength(1));
  });

  it('says there is no eligible arbitrator in a muted line, not a callout', () => {
    render(<ConsensusConfigForm value={ARBITRATOR_RULE} onChange={vi.fn()} members={[]} />);
    expect(screen.getByText(consensus.arbitratorNoEligibleMembers)).toHaveClass('text-[13px]', 'text-muted-foreground');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(consensus.arbitratorRequired)).toBeNull();
  });
});
