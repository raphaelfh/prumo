// frontend/components/extraction/dialogs/ProjectTemplatesList.tsx
/**
 * "This project's templates" — every extraction template of the project,
 * active AND inactive (spec §3.5: a file-imported template has no catalogue
 * row, so this list is the only place it stays reachable once deactivated).
 * Inactive rows carry Switch (PATCH is_active) and Delete (confirm → DELETE);
 * the active row carries neither. Delete reports to nobody: nothing outside
 * this list holds an inactive row, and both writes invalidate the shared
 * project-template query, so the list (and the screen behind it) re-render
 * from one fetch.
 */

import {useState} from 'react';
import {Loader2, Trash2} from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {
  useDeleteProjectTemplate,
  useProjectTemplates,
  useSetProjectTemplateActive,
  type ProjectTemplate,
} from '@/hooks/hitl/useProjectTemplates';
import {t} from '@/lib/copy';

interface ProjectTemplatesListProps {
  projectId: string;
  onSwitched: (templateId: string) => void;
}

export function ProjectTemplatesList({projectId, onSwitched}: ProjectTemplatesListProps) {
  const {
    data,
    isLoading,
    error,
  } = useProjectTemplates({projectId, kind: 'extraction', includeInactive: true});
  const switchTemplate = useSetProjectTemplateActive(projectId);
  const deleteProjectTemplate = useDeleteProjectTemplate(projectId);
  const [pendingDelete, setPendingDelete] = useState<ProjectTemplate | null>(null);

  const templates = data ?? [];
  // One row at a time: whichever write is in flight owns the spinner and
  // disables the others.
  const busyId = switchTemplate.isPending
    ? switchTemplate.variables.templateId
    : deleteProjectTemplate.isPending
      ? deleteProjectTemplate.variables
      : null;

  const handleSwitch = (tpl: ProjectTemplate) => {
    // Report only what the server accepted; the refusal already toasted.
    void switchTemplate
      .mutateAsync({templateId: tpl.id, isActive: true})
      .then(() => onSwitched(tpl.id), () => undefined);
  };

  const handleDeleteConfirmed = () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    deleteProjectTemplate.mutate(target.id);
  };

  // The enclosing tab is labelled "This project"; a visible heading would
  // repeat it, so the accessible name lives on the section instead.
  return (
    <section aria-label={t('templateConfig', 'projectTemplatesHeading')} className="space-y-2">
      {isLoading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t('templateConfig', 'importLoadingTemplates')}
        </div>
      ) : templates.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{t('templateConfig', 'projectTemplatesEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border/40 rounded-md border border-border/40">
          {templates.map((tpl) => (
            <li
              key={tpl.id}
              data-testid={`project-template-row-${tpl.id}`}
              className="flex items-center gap-3 px-3 py-2 text-[13px]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-foreground">{tpl.name}</span>
                  <Badge variant="outline" className="text-[11px] uppercase">{tpl.framework}</Badge>
                  {tpl.is_active && (
                    <Badge
                      variant="secondary"
                      data-testid={`project-template-active-${tpl.id}`}
                      className="text-[11px]"
                    >
                      {t('templateConfig', 'projectTemplateActive')}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('templateConfig', 'projectTemplateCreated').replace(
                    '{{date}}',
                    new Date(tpl.created_at).toLocaleDateString(),
                  )}
                </div>
              </div>
              {!tpl.is_active && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid={`project-template-switch-${tpl.id}`}
                        disabled={busyId !== null}
                        onClick={() => handleSwitch(tpl)}
                      >
                        {busyId === tpl.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                        {t('templateConfig', 'projectTemplateSwitch')}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('templateConfig', 'projectTemplateSwitchTooltip')}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={t('templateConfig', 'projectTemplateDelete')}
                        data-testid={`project-template-delete-${tpl.id}`}
                        disabled={busyId !== null}
                        onClick={() => setPendingDelete(tpl)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('templateConfig', 'projectTemplateDelete')}</TooltipContent>
                  </Tooltip>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" data-testid="project-templates-error" className="text-xs text-destructive">
          {t('templateConfig', 'projectTemplatesRefreshFailed')}: {error.message}
        </p>
      )}
      {deleteProjectTemplate.error && (
        <p role="alert" data-testid="project-template-delete-error" className="text-xs text-destructive">
          {deleteProjectTemplate.error.message}
        </p>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('templateConfig', 'projectTemplateDeleteTitle').replace('{{name}}', pendingDelete?.name ?? '')}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('templateConfig', 'projectTemplateDeleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common', 'cancel')}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="project-template-delete-confirm"
              onClick={handleDeleteConfirmed}
            >
              {t('templateConfig', 'projectTemplateDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
