/**
 * Reusable consensus form — works for both project- and template-scope.
 * The parent owns persistence; this component is purely controlled.
 */

import { useMemo } from 'react';
import { Info } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SettingsField } from '@/components/settings';
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
  /** Minimum reviewer_count allowed (defaults to 1). */
  minReviewers?: number;
  /** Maximum reviewer_count allowed (defaults to 20). */
  maxReviewers?: number;
}

export function ConsensusConfigForm({
  value,
  onChange,
  members,
  membersLoading = false,
  disabled = false,
  minReviewers = 1,
  maxReviewers = 20,
}: ConsensusConfigFormProps) {
  const arbitratorEligible = useMemo(
    () => members.filter((m) => m.role === 'consensus' || m.role === 'manager'),
    [members],
  );

  const handleReviewerCountChange = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return;
    const clamped = Math.min(maxReviewers, Math.max(minReviewers, parsed));
    onChange({ ...value, reviewer_count: clamped });
  };

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
  const arbitratorMissing =
    showArbitratorPicker &&
    (!value.arbitrator_id ||
      !arbitratorEligible.some((m) => m.user_id === value.arbitrator_id));

  return (
    <div className="space-y-4">
      <SettingsField
        label={t('consensus', 'reviewerCountLabel')}
        hint={t('consensus', 'reviewerCountHint')}
        htmlFor="reviewer-count"
      >
        <Input
          id="reviewer-count"
          type="number"
          min={minReviewers}
          max={maxReviewers}
          value={value.reviewer_count}
          onChange={(e) => handleReviewerCountChange(e.target.value)}
          disabled={disabled}
          className="w-32"
        />
      </SettingsField>

      <SettingsField
        label={t('consensus', 'ruleLabel')}
        hint={t('consensus', 'ruleHint')}
        htmlFor="consensus-rule"
      >
        <Select
          value={value.consensus_rule}
          onValueChange={(v) => handleRuleChange(v as ConsensusRule)}
          disabled={disabled}
        >
          <SelectTrigger id="consensus-rule" className="w-full max-w-md">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unanimous">
              {t('consensus', 'ruleUnanimous')}
            </SelectItem>
            <SelectItem value="majority">
              {t('consensus', 'ruleMajority')}
            </SelectItem>
            <SelectItem value="arbitrator">
              {t('consensus', 'ruleArbitrator')}
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingsField>

      {showArbitratorPicker && (
        <SettingsField
          label={t('consensus', 'arbitratorLabel')}
          hint={t('consensus', 'arbitratorHint')}
          htmlFor="arbitrator-id"
          required
        >
          {arbitratorEligible.length === 0 ? (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-[12px]">
                {t('consensus', 'arbitratorNoEligibleMembers')}
              </AlertDescription>
            </Alert>
          ) : (
            <Select
              value={value.arbitrator_id ?? ''}
              onValueChange={handleArbitratorChange}
              disabled={disabled || membersLoading}
            >
              <SelectTrigger id="arbitrator-id" className="w-full max-w-md">
                <SelectValue
                  placeholder={t('consensus', 'arbitratorPlaceholder')}
                />
              </SelectTrigger>
              <SelectContent>
                {arbitratorEligible.map((member) => (
                  <SelectItem key={member.user_id} value={member.user_id}>
                    {member.user_full_name ??
                      member.user_email ??
                      t('project', 'teamUserFallback')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </SettingsField>
      )}

      {arbitratorMissing && arbitratorEligible.length > 0 && (
        <p className="text-[12px] text-destructive">
          {t('consensus', 'arbitratorRequired')}
        </p>
      )}
    </div>
  );
}
