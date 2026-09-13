/**
 * State for one kind's manager-review-visibility switch: optimistic toggle,
 * revert on failure, toasts, and a render-phase re-sync when the persisted
 * value arrives after mount. Shared by `ManagerReviewVisibilityToggle` (QA
 * Configuration) and the Review consensus settings row. The write stays the
 * typed `setManagerReviewVisibility` endpoint, which sets only its own kind.
 *
 * A verbatim, behaviour-preserving extraction of the toggle's former state
 * block (spec 2026-09-13 §10): `ManagerReviewVisibilityToggle.test` passes
 * unchanged. Recorded debt, deliberately not paid here: this is plain
 * useState, not a TanStack `useMutation`, and `setManagerReviewVisibility`
 * rejects instead of returning `ErrorResult<T>`. Converting both is a follow-up.
 */
import {useState} from 'react';
import {toast} from 'sonner';

import {t} from '@/lib/copy';
import type {ReviewKind} from '@/lib/comparison/permissions';
import {setManagerReviewVisibility} from '@/services/hitlConfigService';

export function useManagerReviewVisibility(projectId: string, kind: ReviewKind, currentValue: boolean) {
  const [checked, setChecked] = useState(currentValue);
  const [saving, setSaving] = useState(false);

  const [prevCurrent, setPrevCurrent] = useState(currentValue);
  if (prevCurrent !== currentValue) {
    setPrevCurrent(currentValue);
    setChecked(currentValue);
  }

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

  return {checked, saving, onToggle};
}
