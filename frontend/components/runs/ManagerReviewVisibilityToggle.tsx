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

import { Switch } from '@/components/ui/switch';
import { useManagerReviewVisibility } from '@/hooks/hitl/useManagerReviewVisibility';
import { t } from '@/lib/copy';
import type { ReviewKind } from '@/lib/comparison/permissions';

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
  const { checked, saving, onToggle } = useManagerReviewVisibility(projectId, kind, currentValue);

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
