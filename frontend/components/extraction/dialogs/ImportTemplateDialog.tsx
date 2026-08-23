/**
 * Switch template — the project's own templates (switch / delete), the
 * global catalogue (clone), and a file import (prumo-template@1). Hosted by
 * TemplateConfigEditor and ExtractionInterface. Every path that changes
 * the ACTIVE template reports it through one callback,
 * `onActiveTemplateChanged(id)`, so the host can re-point its state.
 */

import {useId, useState} from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {RadioGroup, RadioGroupItem} from '@/components/ui/radio-group';
import {Label} from '@/components/ui/label';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {AlertTriangle, CheckCircle2, FileText, Layers, Loader2, Upload} from 'lucide-react';
import {useGlobalTemplates} from '@/hooks/extraction/useGlobalTemplates';
import {useInvalidateProjectTemplates} from '@/hooks/hitl/useProjectTemplates';
import {importGlobalTemplate} from '@/services/templateImportService';

import {ImportTemplateFilePane} from './ImportTemplateFilePane';
import {ProjectTemplatesList} from './ProjectTemplatesList';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

// =================== INTERFACES ===================

interface ImportTemplateDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after a catalogue import, a file import, or a Switch — the
   * active template is now `templateId`. */
  onActiveTemplateChanged: (templateId: string) => void;
    /** When set, this template is pre-selected when the dialog opens. */
    initialTemplateId?: string | null;
}

// =================== COMPONENT ===================

export function ImportTemplateDialog({
  projectId,
  open,
  onOpenChange,
  onActiveTemplateChanged,
                                         initialTemplateId,
}: ImportTemplateDialogProps) {
  const { templates, loading: loadingTemplates } = useGlobalTemplates();
  const invalidateProjectTemplates = useInvalidateProjectTemplates();
  const catalogueHeadingId = useId();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);

    // Sync selection when dialog opens with initialTemplateId (e.g. from
    // config page list) — adjusted during render instead of via effect.
    const [prevSyncKey, setPrevSyncKey] = useState<{
        open: boolean;
        initialTemplateId: typeof initialTemplateId;
        templates: typeof templates;
    } | null>(null);
    if (
        !prevSyncKey ||
        open !== prevSyncKey.open ||
        initialTemplateId !== prevSyncKey.initialTemplateId ||
        templates !== prevSyncKey.templates
    ) {
        setPrevSyncKey({open, initialTemplateId, templates});
        if (open) {
            if (initialTemplateId && templates.some(t => t.id === initialTemplateId)) {
                setSelectedTemplateId(initialTemplateId);
            } else if (!initialTemplateId) {
                setSelectedTemplateId(null);
            }
        }
    }

  const handleImport = async () => {
    if (!selectedTemplate) {
        toast.error(t('templateConfig', 'importErrorSelect'));
      return;
    }

    setImporting(true);

    console.warn('[ImportTemplateDialog] import:', selectedTemplate.name);

    const result = await importGlobalTemplate(projectId, selectedTemplate.id);

    setImporting(false);

    if (!result.ok) {
      console.error('[ImportTemplateDialog] import failed', result.error);
      toast.error(`${t('templateConfig', 'importErrorImport')}: ${result.error.message}`);
      return;
    }
    toast.success(
        `${t('templateConfig', 'importSuccess')}: "${selectedTemplate.name}". ${result.data.entityTypesAdded} ${t('templateConfig', 'importSections')}, ${result.data.fieldsAdded} ${t('templateConfig', 'importFields')}.`
    );
    await closeAfterImport(result.data.templateId);
  };

  /** Every path that changed the active template ends the same way: close,
   * then hand the host the id to select. */
  const closeWith = (templateId: string) => {
    onOpenChange(false);
    onActiveTemplateChanged(templateId);
  };

  /**
   * The two import panes go straight to a typed service, so nothing has
   * refreshed the shared project-template query yet — do it before the host
   * re-points, or it lands on a row it cannot see. Switch needs no such wait:
   * its mutation awaits its own invalidation before calling back.
   */
  const closeAfterImport = async (templateId: string) => {
    onOpenChange(false);
    await invalidateProjectTemplates();
    onActiveTemplateChanged(templateId);
  };

  const handleClose = () => {
    if (!importing) {
      setSelectedTemplateId(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-[680px] max-h-[90vh] overflow-y-auto"
        data-testid="import-template-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
              {t('templateConfig', 'importTitle')}
          </DialogTitle>
          <DialogDescription>
              {t('templateConfig', 'importDesc')}
          </DialogDescription>
        </DialogHeader>

        <ProjectTemplatesList projectId={projectId} onSwitched={closeWith} />

        <section aria-labelledby={catalogueHeadingId} className="space-y-2">
        <h3 id={catalogueHeadingId} className="text-[13px] font-medium text-foreground">
          {t('templateConfig', 'importFromCatalogueHeading')}
        </h3>
        {loadingTemplates ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>{t('templateConfig', 'importLoadingTemplates')}</span>
          </div>
        ) : templates.length === 0 ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
                {t('templateConfig', 'importNoTemplates')}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            {/* Lista de templates */}
            <RadioGroup value={selectedTemplateId || ''} onValueChange={setSelectedTemplateId}>
              <div className="space-y-2">
                {templates.map((template) => {
                  const isSelected = selectedTemplateId === template.id;
                  return (
                    <Card
                      key={template.id}
                      onClick={() => setSelectedTemplateId(template.id)}
                      className={cn(
                        'group cursor-pointer border border-border/60 bg-card transition-colors duration-75',
                        'hover:bg-muted/50',
                        'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
                        isSelected && 'border-primary/60 bg-muted/30 ring-1 ring-primary/30',
                      )}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <RadioGroupItem value={template.id} id={template.id} />
                            <div>
                              <CardTitle className="text-base text-foreground">
                                <Label htmlFor={template.id} className="cursor-pointer">
                                  {template.name}
                                </Label>
                              </CardTitle>
                              <CardDescription className="text-xs mt-1 text-muted-foreground">
                                {template.description}
                              </CardDescription>
                            </div>
                          </div>
                          <Badge variant="outline" className="ml-2">
                            {template.framework}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1.5">
                            <Layers className="h-4 w-4" strokeWidth={1.5} />
                              <span>{template.entityTypesCount} {t('templateConfig', 'importSections')}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <FileText className="h-4 w-4" strokeWidth={1.5} />
                            <span>v{template.version}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </RadioGroup>

            {/* Preview do template selecionado */}
            {selectedTemplate && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                    <div className="font-medium mb-1">{t('templateConfig', 'importTemplateSelected')}</div>
                  <div className="text-sm">
                      <strong>{selectedTemplate.name}</strong> — {selectedTemplate.entityTypesCount} {t('templateConfig', 'importSections')}. {t('templateConfig', 'importTemplateSelectedDetail')}
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
        </section>

        <ImportTemplateFilePane projectId={projectId} onImported={closeAfterImport} />

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={importing}
          >
              {t('common', 'cancel')}
          </Button>
          <Button
            type="button"
            data-testid="import-template-submit"
            onClick={handleImport}
            disabled={!selectedTemplateId || importing || loadingTemplates}
          >
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t('templateConfig', 'importImporting')}
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                  {t('templateConfig', 'importImportButton')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
