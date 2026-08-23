// frontend/components/extraction/dialogs/ProjectTemplatesList.tsx
/**
 * "This project's templates" — every extraction template of the project,
 * active AND inactive (spec §3.5: a file-imported template has no catalogue
 * row, so this list is the only place it stays reachable once deactivated).
 * Inactive rows carry Switch (PATCH is_active) and Delete (confirm → DELETE);
 * the active row carries neither. Delete reports to nobody: nothing outside
 * this list holds an inactive row, and the list refreshes itself.
 */

import {useState} from 'react';
import {Loader2, Trash2} from 'lucide-react';
import {toast} from 'sonner';

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
import {useHITLProjectTemplates, type ProjectTemplate} from '@/hooks/hitl/useHITLProjectTemplates';
import {t} from '@/lib/copy';
import {deleteTemplate} from '@/services/templateImportService';

interface ProjectTemplatesListProps {
  projectId: string;
  onSwitched: (templateId: string) => void;
}

export function ProjectTemplatesList({projectId, onSwitched}: ProjectTemplatesListProps) {
  const {templates, loading, refresh, setTemplateActive} = useHITLProjectTemplates({
    projectId,
    kind: 'extraction',
    includeInactive: true,
  });
  const [pendingDelete, setPendingDelete] = useState<ProjectTemplate | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleSwitch = async (tpl: ProjectTemplate) => {
    setBusyId(tpl.id);
    const ok = await setTemplateActive(tpl.id, true);
    setBusyId(null);
    if (ok) onSwitched(tpl.id);
  };

  const handleDeleteConfirmed = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setDeleteError(null);
    setBusyId(target.id);
    const result = await deleteTemplate(projectId, target.id);
    setBusyId(null);
    if (!result.ok) {
      setDeleteError(result.error.message);
      return;
    }
    toast.success(t('templateConfig', 'projectTemplateDeleted'));
    await refresh().catch(() => undefined);
  };

  return (
    <section aria-labelledby="project-templates-heading" className="space-y-2">
      <h3 id="project-templates-heading" className="text-[13px] font-medium text-foreground">
        {t('templateConfig', 'projectTemplatesHeading')}
      </h3>
      {loading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t('extraction', 'importLoadingTemplates')}
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
                    <Badge data-testid={`project-template-active-${tpl.id}`} className="text-[11px]">
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
                        onClick={() => void handleSwitch(tpl)}
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
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
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
      {deleteError && (
        <p role="alert" data-testid="project-template-delete-error" className="text-xs text-destructive">
          {deleteError}
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
              onClick={() => void handleDeleteConfirmed()}
            >
              {t('templateConfig', 'projectTemplateDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
