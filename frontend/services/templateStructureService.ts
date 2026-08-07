/**
 * Template ACTIVE-version structure (track B, slice B-3a).
 *
 * The worklist, the dashboard and the exports must render template
 * structure from the ACTIVE snapshot — under B-4 an unpublished draft
 * edit must not move progress numbers project-wide. The config editor
 * deliberately does NOT use this: it must show the draft.
 *
 * Throwing style (hitlConfigService precedent): TanStack owns errors.
 * A template with no active version is a 404 from the backend — never
 * an empty tree, which progress math would read as fully complete.
 */
import {apiClient} from '@/integrations/api';
import type {components} from '@/types/api/schema';

export type TemplateActiveVersionRead =
  components['schemas']['TemplateActiveVersionRead'];
export type ActiveVersionEntityType =
  components['schemas']['RunViewEntityType'];

export function getActiveTemplateStructure(
  projectId: string,
  templateId: string,
): Promise<TemplateActiveVersionRead> {
  return apiClient<TemplateActiveVersionRead>(
    `/api/v1/projects/${projectId}/templates/${templateId}/active-version`,
  );
}
