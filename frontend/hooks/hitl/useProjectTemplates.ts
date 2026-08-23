/**
 * The project's own HITL templates (extraction & quality assessment) as a
 * TanStack query, plus the writes that change the list.
 *
 * One cache entry per (project, kind, includeInactive) is shared by every
 * reader — the extraction screen, the "switch template" list inside the
 * import dialog, the QA Configuration tab — so opening a dialog costs no
 * fetch and no loader. Every write invalidates `projectTemplatesKeys.all`
 * (an import may land on a DIFFERENT template than the one on screen), which
 * is what keeps those readers in step: callbacks between them carry UI
 * intent only ("select this id"), never data.
 *
 * `useHITLProjectTemplates` composes these into the older combined shape.
 */

import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {apiClient} from '@/integrations/api';
import {t} from '@/lib/copy';
import type {ReviewKind} from '@/lib/comparison/permissions';
import {globalTemplateCatalogueKeys, projectTemplatesKeys} from '@/lib/query-keys/extraction';
import {
  fetchGlobalTemplates,
  fetchProjectTemplates,
} from '@/services/qaTemplateService';
import {deleteTemplate} from '@/services/templateImportService';

export type HITLKind = ReviewKind;

export interface ProjectTemplate {
  id: string;
  project_id: string;
  global_template_id: string | null;
  name: string;
  description: string | null;
  framework: string;
  version: string;
  kind: HITLKind;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
}

export interface GlobalTemplate {
  id: string;
  name: string;
  description: string | null;
  framework: string;
  version: string;
  kind: HITLKind;
}

export interface CloneTemplateResponse {
  project_template_id: string;
  version_id: string;
  entity_type_count: number;
  field_count: number;
  created: boolean;
}

interface UpdateActiveResponse {
  project_template_id: string;
  is_active: boolean;
}

/** Templates change rarely and every write invalidates, so a reopened
 * dialog reads the cache; a background refetch keeps a peer manager's
 * change from going unnoticed for long. */
const STALE_MS = 30_000;

export interface UseProjectTemplatesParams {
  projectId: string;
  kind: HITLKind;
  /** Include `is_active=false` rows (the QA Configuration tab and the
   * switch list need them; everyone else wants the active set). */
  includeInactive?: boolean;
}

/** The project's templates of one kind. Disabled until `projectId` is set. */
export function useProjectTemplates({
  projectId,
  kind,
  includeInactive = false,
}: UseProjectTemplatesParams) {
  return useQuery({
    queryKey: projectTemplatesKeys.byProject(projectId, kind, includeInactive),
    enabled: Boolean(projectId),
    staleTime: STALE_MS,
    queryFn: async (): Promise<ProjectTemplate[]> => {
      const result = await fetchProjectTemplates(projectId, kind, includeInactive);
      if (!result.ok) throw result.error;
      return result.data as ProjectTemplate[];
    },
  });
}

/** The global catalogue offered for import. Read-only, one entry per kind. */
export function useGlobalTemplateCatalogue(kind: HITLKind) {
  return useQuery({
    queryKey: globalTemplateCatalogueKeys.byKind(kind),
    staleTime: STALE_MS,
    queryFn: async (): Promise<GlobalTemplate[]> => {
      const result = await fetchGlobalTemplates(kind);
      if (!result.ok) throw result.error;
      return result.data as GlobalTemplate[];
    },
  });
}

/**
 * Refresh every project-template list. Import/create flows that don't own a
 * mutation hook (the dialogs speak to typed services directly) await this
 * before reporting the new id, so the reader that re-points its selection
 * already sees the row.
 */
export function useInvalidateProjectTemplates(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({queryKey: projectTemplatesKeys.all});
}

/** PATCH `is_active`. Toasts both outcomes — the callers render no error of
 * their own for this write. */
export function useSetProjectTemplateActive(projectId: string) {
  const invalidate = useInvalidateProjectTemplates();

  return useMutation({
    mutationFn: ({templateId, isActive}: {templateId: string; isActive: boolean}) =>
      apiClient<UpdateActiveResponse>(
        `/api/v1/projects/${projectId}/templates/${templateId}`,
        {method: 'PATCH', body: {is_active: isActive}},
      ),
    onSuccess: (_data, {isActive}) => {
      toast.success(
        t('extraction', isActive ? 'templateActivatedSuccess' : 'templateDeactivatedSuccess'),
      );
      return invalidate();
    },
    onError: (error: Error) => {
      toast.error(`${t('extraction', 'errors_updateTemplateStatus')}: ${error.message}`);
    },
  });
}

/** Clone a catalogue template into the project (idempotent server-side).
 * Deliberately toast-free: the success copy names the created template, so
 * the caller writes it once it has read the row back. */
export function useCloneGlobalTemplate(projectId: string, kind: HITLKind) {
  const invalidate = useInvalidateProjectTemplates();

  return useMutation({
    mutationFn: (globalTemplateId: string) =>
      apiClient<CloneTemplateResponse>(`/api/v1/projects/${projectId}/templates/clone`, {
        method: 'POST',
        body: {global_template_id: globalTemplateId, kind},
      }),
    onSuccess: () => invalidate(),
    onError: (error: Error) => {
      toast.error(`${t('extraction', 'errors_cloneTemplate')}: ${error.message}`);
    },
  });
}

/** DELETE a project template. The refusal (409 "in use") is rendered inline
 * by the list, so failure raises rather than toasts. */
export function useDeleteProjectTemplate(projectId: string) {
  const invalidate = useInvalidateProjectTemplates();

  return useMutation({
    mutationFn: async (templateId: string): Promise<void> => {
      const result = await deleteTemplate(projectId, templateId);
      if (!result.ok) throw result.error;
    },
    onSuccess: () => {
      toast.success(t('templateConfig', 'projectTemplateDeleted'));
      return invalidate();
    },
  });
}
