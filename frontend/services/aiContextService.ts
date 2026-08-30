/**
 * Per-project AI review-context service (the PICOTS editor's read/write).
 *
 * Both calls route through the typed client and return `ErrorResult<T>` —
 * never throw across the boundary, never toast (do not copy
 * `projectSettingsService.ts`, which writes this column straight over
 * PostgREST and predates that rule).
 *
 * Note what the read carries beyond the stored slots: `labels` are the exact
 * strings the prompt emits for this project's review type, and `preview` is
 * the block the server would pin. Rendering either client-side would let the
 * screen show a review question the AI never received.
 */

import {apiClient} from '@/integrations/api/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

export type ProjectAiContextRead =
  components['schemas']['ProjectAiContextRead'];
export type ProjectAiContextUpdate =
  components['schemas']['ProjectAiContextUpdate'];
export type PicotsSlots = components['schemas']['PicotsSlots'];
export type PicotsSlot = components['schemas']['PicotsSlot'];

export function fetchAiContext(
  projectId: string,
): Promise<ErrorResult<ProjectAiContextRead>> {
  return toResult(
    () =>
      apiClient<ProjectAiContextRead>(
        `/api/v1/projects/${projectId}/ai-context`,
      ),
    'aiContextService.fetchAiContext',
  );
}

export function setAiContext(
  projectId: string,
  body: ProjectAiContextUpdate,
): Promise<ErrorResult<ProjectAiContextRead>> {
  return toResult(
    () =>
      apiClient<ProjectAiContextRead>(
        `/api/v1/projects/${projectId}/ai-context`,
        {method: 'PUT', body},
      ),
    'aiContextService.setAiContext',
  );
}
