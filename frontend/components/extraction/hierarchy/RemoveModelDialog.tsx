/**
 * Remove Model Dialog
 *
 * Confirmation dialog to remove a prediction model.
 * Warns the user if the model has extracted data.
 * 
 * Features:
 * - Aviso destacado se modelo tem dados
 * - Contagem de campos preenchidos
 * - Loading state during removal
 * - Clear messages about consequences
 * 
 * @component
 */

import {useState} from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {AlertTriangle, Info, Loader2, Trash2} from 'lucide-react';
import {extractionLogger} from '@/lib/extraction/observability';
import {t} from '@/lib/copy';

// =================== INTERFACES ===================

interface RemoveModelDialogProps {
  open: boolean;
  modelName: string;
  hasExtractedData: boolean;
  extractedFieldsCount?: number;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

// =================== COMPONENT ===================

export function RemoveModelDialog({
  open,
  modelName,
  hasExtractedData,
  extractedFieldsCount = 0,
  onConfirm,
  onCancel
}: RemoveModelDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

    // Confirmation handler
  const handleConfirm = async () => {
    setLoading(true);
    setError(null);

    try {
        extractionLogger.info('removeModelDialog', 'Starting model removal', {
        modelName,
        hasExtractedData,
        extractedFieldsCount
      });

      await onConfirm();

        extractionLogger.info('removeModelDialog', 'Model removed successfully', {
        modelName
      });

        // Dialog will be closed by parent component
    } catch (err: any) {
        extractionLogger.error('removeModelDialog', 'Failed to remove model', err, {
        modelName,
        hasExtractedData
      });

        setError(err.message || t('extraction', 'removeModelError'));
    } finally {
      // ✅ SEMPRE resetar loading, independente de sucesso/erro
      // Isso previne o modal ficar travado no estado "Removendo..."
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && !loading && onCancel()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
              {t('extraction', 'removeModelTitle')}
          </DialogTitle>
          <DialogDescription>
              {t('extraction', 'removeModelDesc').replace('{{name}}', modelName)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
            {/* Warning if there is extracted data */}
          {hasExtractedData ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-semibold">
                      {t('extraction', 'removeModelWarningTitle')}
                  </p>
                  <p>
                      <strong>{extractedFieldsCount}</strong> {extractedFieldsCount === 1 ? t('extraction', 'removeModelFieldFilled') : t('extraction', 'removeModelFieldsFilled')} in
                      this model.
                  </p>
                  <p className="text-sm">
                      {t('extraction', 'removeModelDataPermanent')}
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                  {t('extraction', 'removeModelNoData')}
              </AlertDescription>
            </Alert>
          )}

            {/* Operation details */}
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <p className="text-sm font-medium text-slate-900 mb-2">
                {t('extraction', 'removeModelWhatRemoved')}
            </p>
            <ul className="space-y-1 text-sm text-slate-600">
              <li className="flex items-start gap-2">
                <span className="text-destructive">•</span>
                  <span>Model "{modelName}"</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-destructive">•</span>
                  <span>{t('extraction', 'removeModelSubsections')}</span>
              </li>
              {hasExtractedData && (
                <li className="flex items-start gap-2">
                  <span className="text-destructive">•</span>
                    <span
                        className="font-medium">{t('extraction', 'removeModelAllValues').replace('{{count}}', String(extractedFieldsCount))}</span>
                </li>
              )}
            </ul>
          </div>

          {/* Erro */}
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={loading}
          >
              {t('common', 'cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('extraction', 'removeModelRemoving')}
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                  {hasExtractedData ? t('extraction', 'removeModelAnyway') : t('extraction', 'removeModel')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

