/**
 * Rename / re-key one entry of a repeating section (identity spec §7 keeps
 * merge out; this is the one identity edit a reviewer makes).
 *
 * One PATCH through the typed endpoint; on success the run view is
 * invalidated so the label and the identity the form shows come back from
 * the server (instances are derived from the run view, not read directly).
 * Toasts live here so the dialogs stay presentational.
 */
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {runsKeys} from '@/hooks/runs/types';
import {
  ApiError,
  updateInstanceIdentity,
  type InstanceIdentityUpdateRequest,
  type InstanceIdentityUpdateResponse,
} from '@/integrations/api/client';
import {t} from '@/lib/copy';

export interface UpdateInstanceIdentityArgs {
  instanceId: string;
  body: InstanceIdentityUpdateRequest;
  /** Entry noun for the toasts (`{{noun}}` interpolation). */
  noun: string;
}

export function useUpdateInstanceIdentity(runId: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation<InstanceIdentityUpdateResponse, Error, UpdateInstanceIdentityArgs>({
    mutationFn: ({instanceId, body}) => updateInstanceIdentity(instanceId, body),
    onSuccess: (_data, {noun}) => {
      toast.success(t('extraction', 'entryUpdatedSuccess').replace('{{noun}}', noun));
      if (runId) void queryClient.invalidateQueries({queryKey: runsKeys.detail(runId)});
    },
    onError: (error, {noun}) => {
      console.error('[useUpdateInstanceIdentity]', error);
      // Only the typed 409 (a sibling holds the key) carries a message worth
      // showing; a 404, 403 or network failure stays generic.
      const generic = t('extraction', 'errors_updateEntry').replace('{{noun}}', noun);
      const isDuplicate = error instanceof ApiError && error.status === 409;
      toast.error(isDuplicate ? `${generic}: ${error.message}` : generic);
    },
  });
}
