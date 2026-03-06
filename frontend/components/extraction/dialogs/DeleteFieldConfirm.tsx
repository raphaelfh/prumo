/**
 * Confirmation dialog to delete field
 *
 * Features:
 * - Shows impact of deletion (extracted values, affected articles)
 * - Blocks deletion if there is data
 * - Clear visual warnings with appropriate colors
 * - Loading state during operation
 *
 * @component
 */

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
import { AlertCircle, Loader2, AlertTriangle } from 'lucide-react';
import { ExtractionField, FieldValidationResult } from '@/types/extraction';
import { Badge } from '@/components/ui/badge';
import {t} from '@/lib/copy';

interface DeleteFieldConfirmProps {
  field: ExtractionField | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (fieldId: string) => Promise<boolean>;
  validation: FieldValidationResult | null;
  loading: boolean;
}

export function DeleteFieldConfirm({
  field,
  open,
  onOpenChange,
  onConfirm,
  validation,
  loading,
}: DeleteFieldConfirmProps) {
  if (!field) return null;

  const canDelete = validation?.canDelete ?? false;
  const extractedCount = validation?.extractedValuesCount ?? 0;
  const affectedArticlesCount = validation?.affectedArticles?.length ?? 0;

  const handleConfirm = async () => {
    const success = await onConfirm(field.id);
    if (success) {
      onOpenChange(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {canDelete ? (
              <>
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                  {t('extraction', 'confirmDeleteTitle')}
              </>
            ) : (
              <>
                <AlertCircle className="h-5 w-5 text-destructive" />
                  {t('extraction', 'cannotDelete')}
              </>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 pt-2">
                {/* Field information */}
              <div>
                <p className="text-foreground">
                    {t('extraction', 'youAreTryingToDelete')}
                </p>
                <div className="mt-2 rounded-lg bg-muted p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground">{field.label}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                          {field.description || t('extraction', 'noDescription')}
                      </p>
                    </div>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {field.field_type}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Aviso baseado no status */}
              {canDelete ? (
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                        <p className="font-medium text-orange-900">{t('common', 'attention')}</p>
                      <ul className="mt-2 list-disc list-inside space-y-1 text-sm text-orange-800">
                          <li>{t('extraction', 'deleteFieldWarningUndo')}</li>
                          <li>{t('extraction', 'deleteFieldWarningRemoved')}</li>
                          <li>{t('extraction', 'deleteFieldWarningNewArticles')}</li>
                          <li>{t('extraction', 'deleteFieldWarningExisting')}</li>
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                        <p className="font-medium text-destructive">{t('extraction', 'impossibleToDelete')}</p>
                      <ul className="mt-2 list-disc list-inside space-y-1 text-sm text-destructive/90">
                        <li>
                            {t('extraction', 'cannotDeleteReason').replace('{{count}}', String(extractedCount))}
                        </li>
                        <li>
                            {t('extraction', 'cannotDeleteAffects').replace('{{count}}', String(affectedArticlesCount))}
                        </li>
                        <li>
                            {t('extraction', 'cannotDeleteWouldLose')}
                        </li>
                      </ul>
                      <div className="mt-3 p-2 bg-muted rounded text-xs">
                          <p className="font-medium">💡 {t('extraction', 'alternativesTip')}</p>
                        <ul className="mt-1 list-disc list-inside">
                            <li>{t('extraction', 'markNotRequired')}</li>
                            <li>{t('extraction', 'deleteValuesFirst')}</li>
                            <li>{t('extraction', 'contactAdmin')}</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>
              {canDelete ? t('common', 'cancel') : t('extraction', 'understood')}
          </AlertDialogCancel>
          {canDelete && (
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={loading}
              className="bg-destructive hover:bg-destructive/90"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('extraction', 'deleteField')}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

