/**
 * The project's own HITL templates (extraction & quality assessment) as a
 * TanStack query, plus the writes that change the list.
 *
 * One cache entry per (project, kind) is shared by every reader — the
 * extraction screen, the "switch template" list inside the import dialog,
 * the QA Configuration tab. Readers that want only the active templates
 * narrow those same rows with a `select`, so no reader opens a second entry
 * the next write would have to refetch alongside the first.
 *
 * Every write invalidates `projectTemplatesKeys.all` (an import may land on
 * a DIFFERENT template than the one on screen) and awaits that invalidation
 * before it resolves. That is what lets the callbacks between these screens
 * carry UI intent only — "select this id" — never data.
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
  type GlobalTemplateRow,
  type ProjectTemplateRow,
} from '@/services/qaTemplateService';
import {deleteTemplate} from '@/services/templateImportService';
import type {components} from '@/types/api/schema';

export type HITLKind = ReviewKind;
export type ProjectTemplate = ProjectTemplateRow;
export type GlobalTemplate = GlobalTemplateRow;

type CloneTemplateResponse = components['schemas']['CloneTemplateResponse'];
type UpdateTemplateActiveResponse = components['schemas']['UpdateTemplateActiveResponse'];

/** Templates change rarely and every write invalidates, so a reopened
 * dialog reads the cache; a background refetch keeps a peer manager's
 * change from going unnoticed for long. */
const STALE_MS = 30_000;

/** Module-level so the observer's `select` identity is stable across
 * renders — a fresh closure per render would re-run it every time. */
const ACTIVE_ONLY = (rows: ProjectTemplate[]): ProjectTemplate[] =>
  rows.filter((tpl) => tpl.is_active);

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
    queryKey: projectTemplatesKeys.byProject(projectId, kind),
    enabled: Boolean(projectId),
    staleTime: STALE_MS,
    select: includeInactive ? undefined : ACTIVE_ONLY,
    // Always the full set: one cache entry serves both readers, and v5
    // structurally shares the `select` result so the active-only readers
    // don't re-render when an inactive row changes.
    queryFn: async (): Promise<ProjectTemplate[]> => {
      const result = await fetchProjectTemplates(projectId, kind, true);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

/** The global catalogue offered for import. Read-only, one entry per kind. */
export function useGlobalTemplateCatalogue(kind: HITLKind, {enabled = true} = {}) {
  return useQuery({
    queryKey: globalTemplateCatalogueKeys.byKind(kind),
    enabled,
    staleTime: STALE_MS,
    queryFn: async (): Promise<GlobalTemplate[]> => {
      const result = await fetchGlobalTemplates(kind);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

/**
 * Refresh every project-template list. The write hooks below use it; so do
 * the import flows that go straight to a typed service and own no mutation
 * (the catalogue and file imports), which await it before reporting the new
 * id so the reader that re-points its selection already sees the row.
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
      apiClient<UpdateTemplateActiveResponse>(
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
        // Matches templateImportService.importGlobalTemplate: a clone can run
        // long over WAN + pooler (heal path, many flushes).
        timeout: 120_000,
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
