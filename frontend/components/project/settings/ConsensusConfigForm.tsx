/**
 * Reusable consensus form — works for both project- and template-scope.
 * The parent owns persistence; this component is purely controlled.
 * Renders a fragment of SettingsRows; the caller owns the SettingsGroup.
 */

import { useId } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsRow } from '@/components/settings';
import { t } from '@/lib/copy';
import type {
  ConsensusRule,
  HitlConfigPayload,
} from '@/services/hitlConfigService';
import type { ProjectMemberSummary } from '@/hooks/hitl/useProjectMembers';

export interface ConsensusConfigFormProps {
  value: HitlConfigPayload;
  onChange: (next: HitlConfigPayload) => void;
  members: ProjectMemberSummary[];
  membersLoading?: boolean;
  disabled?: boolean;
}

/** Returns rows, not a wrapper: render it directly inside a SettingsGroup body. */
export function ConsensusConfigForm({
  value,
  onChange,
  members,
  membersLoading = false,
  disabled = false,
}: ConsensusConfigFormProps) {
  // Several forms mount at once (project default + expanded overrides).
  const baseId = useId();
  const ruleId = `${baseId}-rule`;
  const arbitratorId = `${baseId}-arbitrator`;
  const arbitratorEligible = members.filter((m) => m.role === 'consensus' || m.role === 'manager');

  const handleRuleChange = (rule: ConsensusRule) => {
    if (rule === 'arbitrator') {
      onChange({ ...value, consensus_rule: rule });
    } else {
      // Drop arbitrator when the rule no longer requires one.
      onChange({ ...value, consensus_rule: rule, arbitrator_id: null });
    }
  };

  const handleArbitratorChange = (id: string) => {
    onChange({ ...value, arbitrator_id: id });
  };

  const showArbitratorPicker = value.consensus_rule === 'arbitrator';
  const noEligible = arbitratorEligible.length === 0;
  const arbitratorMissing =
    showArbitratorPicker &&
    (!value.arbitrator_id ||
      !arbitratorEligible.some((m) => m.user_id === value.arbitrator_id));

  return (
    <>
      <SettingsRow label={t('consensus', 'ruleLabel')} htmlFor={ruleId} hint={t('consensus', 'ruleHint')}>
        {({ describedBy }) => (
          <Select
            value={value.consensus_rule}
            onValueChange={(v) => handleRuleChange(v as ConsensusRule)}
            disabled={disabled}
          >
            <SelectTrigger id={ruleId} variant="quiet" aria-describedby={describedBy} className="w-full max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unanimous">{t('consensus', 'ruleUnanimous')}</SelectItem>
              <SelectItem value="majority">{t('consensus', 'ruleMajority')}</SelectItem>
              <SelectItem value="arbitrator">{t('consensus', 'ruleArbitrator')}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </SettingsRow>

      {showArbitratorPicker && (
        <SettingsRow
          label={t('consensus', 'arbitratorLabel')}
          htmlFor={noEligible ? undefined : arbitratorId}
          hint={t('consensus', 'arbitratorHint')}
          required
          error={arbitratorMissing && !noEligible ? t('consensus', 'arbitratorRequired') : undefined}
        >
          {({ describedBy }) =>
            noEligible ? (
              <p className="px-2 text-[13px] text-muted-foreground">
                {t('consensus', 'arbitratorNoEligibleMembers')}
              </p>
            ) : (
              <Select
                value={value.arbitrator_id ?? ''}
                onValueChange={handleArbitratorChange}
                disabled={disabled || membersLoading}
              >
                <SelectTrigger id={arbitratorId} variant="quiet" aria-describedby={describedBy} className="w-full max-w-md">
                  <SelectValue placeholder={t('consensus', 'arbitratorPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {arbitratorEligible.map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {member.user_full_name ?? member.user_email ?? t('project', 'teamUserFallback')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          }
        </SettingsRow>
      )}
    </>
  );
}
