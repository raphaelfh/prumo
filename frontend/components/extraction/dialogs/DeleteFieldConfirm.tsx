/**
 * Confirmation dialog to delete field
 *
 * Features:
 * - Owns its impact pre-fetch through `onValidate` (B-5 Task 7 folded
 *   the third copy of that flow in here)
 * - Shows impact of deletion (extracted values, affected articles)
 * - Blocks deletion if there is data — ADVISORY: the DB's RESTRICT FKs
 *   (mapped to friendly copy in the service) are the real invariant
 * - Clear visual warnings with appropriate colors
 * - Loading state during operation
 *
 * @component
 */

import {useEffect, useState} from 'react';

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
  /** Impact pre-fetch. Contract: must RESOLVE (never reject) — on a
   * probe failure, resolve a cannot-delete result with its message. */
  onValidate: (fieldId: string) => Promise<FieldValidationResult>;
}

export function DeleteFieldConfirm({
  field,
  open,
  onOpenChange,
  onConfirm,
  onValidate,
}: DeleteFieldConfirmProps) {
  const [validation, setValidation] = useState<FieldValidationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const fieldId = field?.id ?? null;

  useEffect(() => {
    if (!fieldId) return;
    let cancelled = false;
    // Microtask so the state writes land in an async callback — the
    // pattern the sibling loaders use (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setValidation(null);
      void onValidate(fieldId).then((result) => {
        if (cancelled) return;
        setValidation(result);
        setLoading(false);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [fieldId, onValidate]);

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
                <AlertTriangle className="h-5 w-5 text-warning" />
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
                <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-warning mt-0.5 shrink-0" />
                    <div className="flex-1">
                        <p className="font-medium text-foreground">{t('common', 'attention')}</p>
                      <ul className="mt-2 list-disc list-inside space-y-1 text-sm text-foreground/80">
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
                    <AlertCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
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
              // preventDefault stops Radix's auto-close: the dialog only
              // closes when onConfirm reports success — a refused delete
              // keeps the impact context on screen.
              onClick={(event) => {
                event.preventDefault();
                void handleConfirm();
              }}
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

