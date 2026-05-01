/**
 * Import a global extraction template into the current project.
 *
 * Lists catalogue entries, lets the user pick one, then calls
 * `importGlobalTemplate` (backend clone endpoint). Shows loading and toast
 * feedback.
 */

import {useEffect, useState} from 'react';
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
import {AlertTriangle, CheckCircle2, Download, FileText, Layers, Loader2} from 'lucide-react';
import {useGlobalTemplates} from '@/hooks/extraction/useGlobalTemplates';
import {importGlobalTemplate} from '@/services/templateImportService';
import {toast} from 'sonner';
import {t} from '@/lib/copy';

// =================== INTERFACES ===================

interface ImportTemplateDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTemplateImported: (templateId?: string) => void;
    /** When set, this template is pre-selected when the dialog opens. */
    initialTemplateId?: string | null;
}

// =================== COMPONENT ===================

export function ImportTemplateDialog({
  projectId,
  open,
  onOpenChange,
  onTemplateImported,
                                         initialTemplateId,
}: ImportTemplateDialogProps) {
  const { templates, loading: loadingTemplates } = useGlobalTemplates();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);

    // Sync selection when dialog opens with initialTemplateId (e.g. from config page list)
    useEffect(() => {
        if (!open) return;
        if (initialTemplateId && templates.some(t => t.id === initialTemplateId)) {
            setSelectedTemplateId(initialTemplateId);
        } else if (!initialTemplateId) {
            setSelectedTemplateId(null);
        }
    }, [open, initialTemplateId, templates]);

  const handleImport = async () => {
    if (!selectedTemplate) {
        toast.error(t('extraction', 'importErrorSelect'));
      return;
    }

    setImporting(true);

    try {
        console.warn('[ImportTemplateDialog] import:', selectedTemplate.name);

      const result = await importGlobalTemplate(projectId, selectedTemplate.id);

      if (result.success) {
        toast.success(
            `${t('extraction', 'importSuccess')}: "${selectedTemplate.name}". ${result.details?.entityTypesAdded} ${t('extraction', 'importSections')}, ${result.details?.fieldsAdded} fields.`
        );
        onOpenChange(false);
        onTemplateImported(result.templateId);
      } else {
          throw new Error(result.error || 'Unknown error');
      }

    } catch (error: any) {
      console.error('[ImportTemplateDialog] import failed', error);
        toast.error(`${t('extraction', 'importErrorImport')}: ${error.message}`);
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    if (!importing) {
      setSelectedTemplateId(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
              {t('extraction', 'importTitle')}
          </DialogTitle>
          <DialogDescription>
              {t('extraction', 'importDesc')}
          </DialogDescription>
        </DialogHeader>

        {loadingTemplates ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>{t('extraction', 'importLoadingTemplates')}</span>
          </div>
        ) : templates.length === 0 ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
                {t('extraction', 'importNoTemplates')}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            {/* Lista de templates */}
            <RadioGroup value={selectedTemplateId || ''} onValueChange={setSelectedTemplateId}>
              <div className="space-y-3">
                {templates.map((template) => (
                  <Card 
                    key={template.id}
                    className={`group cursor-pointer transition-all ${
                      selectedTemplateId === template.id 
                        ? 'ring-2 ring-primary' 
                        : 'hover:bg-primary'
                    }`}
                    onClick={() => setSelectedTemplateId(template.id)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <RadioGroupItem value={template.id} id={template.id} className="group-hover:text-white group-hover:border-white" />
                          <div>
                            <CardTitle className="text-base group-hover:text-white">
                              <Label htmlFor={template.id} className="cursor-pointer group-hover:text-white">
                                {template.name}
                              </Label>
                            </CardTitle>
                            <CardDescription className="text-xs mt-1 group-hover:text-white">
                              {template.description}
                            </CardDescription>
                          </div>
                        </div>
                        <Badge variant="outline" className="ml-2 group-hover:text-white group-hover:border-white">
                          {template.framework}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-center gap-4 text-sm text-muted-foreground group-hover:text-white">
                        <div className="flex items-center gap-1">
                          <Layers className="h-4 w-4 group-hover:text-white" />
                            <span>{template.entityTypesCount} {t('extraction', 'importSections')}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <FileText className="h-4 w-4 group-hover:text-white" />
                          <span>v{template.version}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </RadioGroup>

            {/* Preview do template selecionado */}
            {selectedTemplate && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                    <div className="font-medium mb-1">{t('extraction', 'importTemplateSelected')}</div>
                  <div className="text-sm">
                      <strong>{selectedTemplate.name}</strong> — {selectedTemplate.entityTypesCount} {t('extraction', 'importSections')}. {t('extraction', 'importTemplateSelectedDetail')}
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

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
            onClick={handleImport}
            disabled={!selectedTemplateId || importing || loadingTemplates}
          >
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t('extraction', 'importImporting')}
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                  {t('extraction', 'importImportButton')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
