/**
 * The project's templates AND the catalogue to import from, in one shape,
 * for the two screens that render both: the extraction Configuration panel
 * and the QA Configuration tab.
 *
 * A screen that only lists the project's own templates should take
 * `useProjectTemplates` directly and skip the catalogue fetch entirely —
 * `loading` below ORs the two, so a reader that discards `globalTemplates`
 * would still block its first paint on them.
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
  const catalogueQuery = useGlobalTemplateCatalogue(kind, {enabled: Boolean(projectId)});
  const activeMutation = useSetProjectTemplateActive(projectId);
  const cloneMutation = useCloneGlobalTemplate(projectId, kind);

  const templates = projectQuery.data ?? [];

  /**
   * Clone, then read the created row back so the success copy can name it.
   * `mutateAsync` resolves only after the mutation's invalidation settles,
   * so the cache already holds the new row — `projectQuery.data` would be
   * the stale render-time value. A clone the server treated as a no-op
   * (`created: false`) reports nothing: it changed nothing.
   */
  const cloneTemplate = async (globalTemplateId: string): Promise<ProjectTemplate | null> => {
    // The failure toast fires in the mutation's onError; null ends it here.
    const response = await cloneMutation.mutateAsync(globalTemplateId).catch(() => null);
    if (!response) return null;

    const created =
      (queryClient.getQueryData<ProjectTemplate[]>(
        projectTemplatesKeys.byProject(projectId, kind),
      ) ?? []).find((tpl) => tpl.id === response.project_template_id) ?? null;
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
    loading: projectQuery.isLoading || catalogueQuery.isLoading,
    error: projectQuery.error?.message ?? catalogueQuery.error?.message ?? null,
    cloneTemplate,
    setTemplateActive,
    isTemplateImported,
  };
}
