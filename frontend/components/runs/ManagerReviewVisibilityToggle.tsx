/**
 * Per-kind manager-review-visibility toggle.
 *
 * Project-level, manager-only control: when OFF, managers review blind (they
 * see only their own values for this kind); when ON, they see other reviewers.
 * Rendered twice — once per kind — in the extraction (Review consensus) and QA
 * (Configuration) settings surfaces, each bound to its own kind. The write goes
 * through the typed `setManagerReviewVisibility` endpoint and sets only its
 * kind, preserving the other.
 */

import { useState } from 'react';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';
import { t } from '@/lib/copy';
import type { ReviewKind } from '@/lib/comparison/permissions';
import { setManagerReviewVisibility } from '@/services/hitlConfigService';

interface ManagerReviewVisibilityToggleProps {
  projectId: string;
  kind: ReviewKind;
  /** Current persisted value for this kind (from the project's settings). */
  currentValue: boolean;
  /** Disabled unless the viewer can manage blind mode (manager). */
  disabled?: boolean;
}

export function ManagerReviewVisibilityToggle({
  projectId,
  kind,
  currentValue,
  disabled = false,
}: ManagerReviewVisibilityToggleProps) {
  const [checked, setChecked] = useState(currentValue);
  const [saving, setSaving] = useState(false);

  const onToggle = (next: boolean) => {
    setChecked(next); // optimistic
    setSaving(true);
    setManagerReviewVisibility(projectId, kind, next)
      .then(() => toast.success(t('consensus', 'managerVisibilitySaved')))
      .catch((e: unknown) => {
        setChecked(!next); // revert on failure
        toast.error(e instanceof Error ? e.message : t('consensus', 'managerVisibilityError'));
      })
      .finally(() => setSaving(false));
  };

  const id = `manager-visibility-${kind}`;
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {t('consensus', 'managerVisibilityLabel')}
        </label>
        <p className="text-xs text-muted-foreground">
          {t('consensus', 'managerVisibilityHint')}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled || saving}
        onCheckedChange={onToggle}
      />
    </div>
  );
}
