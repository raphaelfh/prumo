/**
 * Dialog to remove section from template
 * 
 * Features:
 * - Impact validation (fields, existing data)
 * - Double confirmation with section name
 * - Detailed visual feedback of what will be removed
 * - Safe CASCADE operation
 * - Logs detalhados para auditoria
 * - Estados de loading apropriados
 * 
 * @component
 */

import {useEffect, useState} from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,} from '@/components/ui/form';
import {AlertTriangle, Database, FileText, Info, Loader2, Trash2, Users} from 'lucide-react';
import {
  analyzeSectionRemovalImpact,
  deleteSection,
} from '@/services/templateService';
import {toast} from 'sonner';
import {t} from '@/lib/copy';

// =================== SCHEMAS ===================

const getRemoveSectionSchema = (sectionName: string) =>
    z.object({
        confirmationName: z.string().min(1, t('extraction', 'confirmSectionName')),
    }).refine((data) => data.confirmationName === sectionName, {
        message: t('extraction', 'confirmSectionNameExact').replace('{{name}}', sectionName),
        path: ['confirmationName'],
    });

type RemoveSectionInput = z.infer<ReturnType<typeof getRemoveSectionSchema>>;

// =================== INTERFACES ===================

interface SectionImpact {
  fieldsCount: number;
  instancesCount: number;
  dataCount: number;
  canDelete: boolean;
  warnings: string[];
}

interface RemoveSectionDialogProps {
  projectId: string;
  templateId: string;
  sectionId: string | null;
  sectionName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSectionRemoved: () => void;
}

// =================== COMPONENT ===================

export function RemoveSectionDialog({
                                        projectId: _projectId,
                                        templateId: _templateId,
  sectionId,
  sectionName,
  open,
  onOpenChange,
  onSectionRemoved,
}: RemoveSectionDialogProps) {
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [impact, setImpact] = useState<SectionImpact | null>(null);

  const form = useForm<RemoveSectionInput>({
      resolver: zodResolver(getRemoveSectionSchema(sectionName)),
    defaultValues: {
      confirmationName: '',
    },
  });

    // Clear the analyzed impact when the dialog closes (during render, so
    // the effect below never sets state synchronously).
  const [prevResetKey, setPrevResetKey] = useState({ open, sectionId });
  if (open !== prevResetKey.open || sectionId !== prevResetKey.sectionId) {
    setPrevResetKey({ open, sectionId });
    if (!(open && sectionId)) {
      setImpact(null);
    }
  }

  const analyzeImpact = async () => {
    if (!sectionId) return;

    setAnalyzing(true);
    console.warn('Analyzing removal impact:', {sectionId, sectionName});

    const result = await analyzeSectionRemovalImpact(sectionId);

    if (!result.ok) {
      console.error('Erro ao analisar impacto:', result.error);
      toast.error(`${t('extraction', 'sectionAnalyzeError')}: ${result.error.message}`);
      setImpact({
        fieldsCount: 0,
        instancesCount: 0,
        dataCount: 0,
        canDelete: false,
        warnings: [t('extraction', 'sectionErrorAnalyzing')],
      });
      setAnalyzing(false);
      return;
    }

    // Build warnings from counts + copy keys (component owns copy)
    const warnings: string[] = [];
    const {fieldsCount, instancesCount, dataCount} = result.data;

    if (fieldsCount > 0) {
      warnings.push(t('extraction', 'sectionWarnFieldsRemoved').replace('{{count}}', String(fieldsCount)));
    }
    if (instancesCount > 1) {
      warnings.push(t('extraction', 'sectionWarnInstancesRemoved').replace('{{count}}', String(instancesCount)));
    }
    if (dataCount > 0) {
      warnings.push(t('extraction', 'sectionWarnDataLost').replace('{{count}}', String(dataCount)));
    }
    if (warnings.length === 0) {
      warnings.push(t('extraction', 'sectionEmptySafe'));
    }

    const impactData: SectionImpact = {
      ...result.data,
      warnings,
    };

    console.warn('📊 Impacto analisado:', impactData);
    setImpact(impactData);
    setAnalyzing(false);
  };

    // Analyze impact when dialog opens; reset the form when it closes.
  useEffect(() => {
    if (open && sectionId) {
      // Microtask so the analyzer's setState calls run in an async callback.
      queueMicrotask(() => void analyzeImpact());
    } else {
      form.reset();
    }
  }, [open, sectionId]);

    const handleSubmit = async (_data: RemoveSectionInput) => {
    if (!sectionId || !impact) return;

    setLoading(true);
    console.warn('Starting section removal:', {sectionId, sectionName});
    console.warn('🎯 Entity type a ser removido:', sectionId);

    const result = await deleteSection(sectionId);

    if (!result.ok) {
      console.error('Error removing section:', result.error);
      toast.error(`${t('extraction', 'sectionRemoveError')}: ${result.error.message}`);
      setLoading(false);
      return;
    }

    console.warn('Entity type and all dependencies removed via CASCADE');
    toast.success(t('extraction', 'sectionRemovedSuccess').replace('{{name}}', sectionName));

    // Fechar dialog e recarregar dados
    onOpenChange(false);
    onSectionRemoved();
    setLoading(false);
  };

  const handleClose = () => {
    if (!loading && !analyzing) {
      form.reset();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
              {t('extraction', 'removeSection')}
          </DialogTitle>
          <DialogDescription>
              {t('extraction', 'removeSectionDesc')}
          </DialogDescription>
        </DialogHeader>

        {analyzing && (
          <div className="flex items-center justify-center p-6">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>{t('extraction', 'analyzingImpact')}</span>
          </div>
        )}

        {impact && !analyzing && (
          <div className="space-y-4">
              {/* Section information */}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                  <div className="font-medium mb-2">{t('extraction', 'sectionToBeRemoved')}</div>
                <div className="font-mono text-sm bg-muted px-2 py-1 rounded">
                  {sectionName}
                </div>
              </AlertDescription>
            </Alert>

            {/* Impacto visual */}
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-muted rounded-lg">
                <FileText className="h-6 w-6 mx-auto mb-1 text-info" />
                <div className="font-bold text-lg text-foreground">{impact.fieldsCount}</div>
                  <div className="text-xs text-muted-foreground">{t('extraction', 'fieldsLabel')}</div>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <Users className="h-6 w-6 mx-auto mb-1 text-success" />
                <div className="font-bold text-lg text-foreground">{impact.instancesCount}</div>
                  <div className="text-xs text-muted-foreground">{t('extraction', 'instancesLabel')}</div>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <Database className="h-6 w-6 mx-auto mb-1 text-primary" />
                <div className="font-bold text-lg text-foreground">{impact.dataCount}</div>
                  <div className="text-xs text-muted-foreground">{t('extraction', 'dataLabel')}</div>
              </div>
            </div>

            {/* Warnings */}
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                  <div className="font-medium mb-2">{t('extraction', 'removalImpactTitle')}</div>
                <ul className="list-disc list-inside space-y-1">
                  {impact.warnings.map((warning, index) => (
                    <li key={index} className="text-sm">{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>

              {/* Confirmation form */}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="confirmationName"
                  render={({ field }) => (
                    <FormItem>
                        <FormLabel>{t('extraction', 'confirmationLabel')}</FormLabel>
                      <FormControl>
                        <Input
                            placeholder={t('extraction', 'sectionConfirmPlaceholder').replace('{{name}}', sectionName)}
                          {...field}
                          disabled={loading}
                        />
                      </FormControl>
                      <FormDescription>
                          {t('extraction', 'confirmRemovalHint')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleClose}
                    disabled={loading}
                  >
                      {t('common', 'cancel')}
                  </Button>
                  <Button 
                    type="submit" 
                    variant="destructive"
                    disabled={loading || !impact.canDelete}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          {t('extraction', 'removingLabel')}
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4 mr-2" />
                          {t('extraction', 'removeSection')}
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}