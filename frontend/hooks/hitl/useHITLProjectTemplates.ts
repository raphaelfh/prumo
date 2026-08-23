/**
 * Project + global templates for the HITL flows (extraction & quality
 * assessment), as one combined shape.
 *
 * This is a thin composition over `useProjectTemplates` — the cached
 * TanStack query that owns the list — plus the catalogue query and the
 * writes. Read it when a screen needs BOTH the project's templates and the
 * catalogue to import from (the QA Configuration tab, the extraction
 * Configuration panel); a screen that only lists the project's own
 * templates should take `useProjectTemplates` directly and skip the
 * catalogue fetch entirely.
 *
 * - ``templates`` lists ``project_extraction_templates`` rows for the
 *   project filtered by ``kind``. Default: only ``is_active=true``; pass
 *   ``includeInactive`` to see the full set (the QA Configuration tab
 *   needs this to render disabled toggles for previously-imported tools).
 * - ``globalTemplates`` lists every global template of the same kind so
 *   the Configuration UI can offer them for import.
 * - ``cloneTemplate`` and ``setTemplateActive`` go through the
 *   ``/api/v1/projects/:id/templates`` endpoints — single source of truth
 *   lives server-side in ``template_clone_service`` — and invalidate the
 *   project-template family so every reader re-renders from one fetch.
 */

import {useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {t} from '@/lib/copy';
import {projectTemplatesKeys} from '@/lib/query-keys/extraction';
import {
  useCloneGlobalTemplate,
  useGlobalTemplateCatalogue,
  useProjectTemplates,
  useSetProjectTemplateActive,
  type GlobalTemplate,
  type HITLKind,
  type ProjectTemplate,
} from './useProjectTemplates';

export type {GlobalTemplate, HITLKind, ProjectTemplate};

interface UseHITLProjectTemplatesProps {
  projectId: string;
  kind: HITLKind;
  includeInactive?: boolean;
}

interface UseHITLProjectTemplatesResult {
  templates: ProjectTemplate[];
  globalTemplates: GlobalTemplate[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<ProjectTemplate[]>;
  cloneTemplate: (globalTemplateId: string) => Promise<ProjectTemplate | null>;
  setTemplateActive: (templateId: string, isActive: boolean) => Promise<boolean>;
  isTemplateImported: (globalTemplateId: string) => boolean;
}

export function useHITLProjectTemplates({
  projectId,
  kind,
  includeInactive = false,
}: UseHITLProjectTemplatesProps): UseHITLProjectTemplatesResult {
  const queryClient = useQueryClient();
  const projectQuery = useProjectTemplates({projectId, kind, includeInactive});
  const catalogueQuery = useGlobalTemplateCatalogue(kind);
  const activeMutation = useSetProjectTemplateActive(projectId);
  const cloneMutation = useCloneGlobalTemplate(projectId, kind);

  const templates = projectQuery.data ?? [];
  const listKey = projectTemplatesKeys.byProject(projectId, kind, includeInactive);

  const refresh = (): Promise<ProjectTemplate[]> =>
    projectQuery.refetch().then((result) => result.data ?? []);

  /**
   * Clone, then read the created row back so the success copy can name it.
   * `mutateAsync` resolves only after the mutation's invalidation settles,
   * so the cache already holds the new row here. A clone the server treated
   * as a no-op (`created: false`) reports nothing — it changed nothing.
   */
  const cloneTemplate = async (globalTemplateId: string): Promise<ProjectTemplate | null> => {
    const response = await cloneMutation
      .mutateAsync(globalTemplateId)
      // The failure toast fires in the mutation's onError; null ends it here.
      .then((data) => data, () => null);
    if (!response) return null;

    const created =
      (queryClient.getQueryData<ProjectTemplate[]>(listKey) ?? []).find(
        (tpl) => tpl.id === response.project_template_id,
      ) ?? null;
    if (response.created) {
      toast.success(
        t('extraction', 'templateClonedSuccess').replace('{{name}}', created?.name ?? ''),
      );
    }
    return created;
  };

  /** `true` when the server accepted; a refusal already surfaced as a toast. */
  const setTemplateActive = (templateId: string, isActive: boolean): Promise<boolean> =>
    activeMutation.mutateAsync({templateId, isActive}).then(() => true, () => false);

  const isTemplateImported = (globalTemplateId: string): boolean =>
    templates.some(
      (tpl) => tpl.global_template_id === globalTemplateId && tpl.is_active,
    );

  return {
    templates,
    globalTemplates: catalogueQuery.data ?? [],
    // Without a project there is nothing to load: the list query is disabled
    // and the catalogue alone must not put the screen in a loading state.
    loading: Boolean(projectId) && (projectQuery.isLoading || catalogueQuery.isLoading),
    error: projectQuery.error?.message ?? catalogueQuery.error?.message ?? null,
    refresh,
    cloneTemplate,
    setTemplateActive,
    isTemplateImported,
  };
}
