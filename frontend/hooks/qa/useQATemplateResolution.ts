/**
 * Resolve the QA route's `:templateId` to a project or a global template.
 *
 * The segment names either the project's own clone (the QA articles table
 * links to it) or a catalogue template, and the session-open request takes
 * the id in a different field for each. Both lists are scoped to the project
 * in the route, so an id from another project resolves as missing. A failed
 * read resolves as an error — never "missing", which would tell the user a
 * template they own does not exist.
 */

import {useGlobalTemplateCatalogue, useProjectTemplates} from '@/hooks/hitl/useProjectTemplates';

export type QATemplateResolution =
  | {kind: 'pending'}
  | {kind: 'error'}
  | {kind: 'missing'}
  | {kind: 'project' | 'global'; id: string};

export function useQATemplateResolution(
  projectId: string | undefined,
  templateId: string | undefined,
): {resolution: QATemplateResolution} {
  const projectTemplates = useProjectTemplates({
    projectId: projectId ?? '',
    kind: 'quality_assessment',
    includeInactive: true,
  });
  const catalogue = useGlobalTemplateCatalogue('quality_assessment', {
    enabled: Boolean(projectId && templateId),
  });

  const resolve = (): QATemplateResolution => {
    if (projectTemplates.isError) return {kind: 'error'};
    if (projectTemplates.isPending) return {kind: 'pending'};
    if (projectTemplates.data.some((tpl) => tpl.id === templateId)) {
      return {kind: 'project', id: templateId as string};
    }
    if (catalogue.isError) return {kind: 'error'};
    if (catalogue.isPending) return {kind: 'pending'};
    if (catalogue.data.some((tpl) => tpl.id === templateId)) {
      return {kind: 'global', id: templateId as string};
    }
    return {kind: 'missing'};
  };

  return {resolution: resolve()};
}
