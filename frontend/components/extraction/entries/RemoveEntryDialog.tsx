/**
 * Confirm removing one entry of a repeating section, and its subtree.
 *
 * Renamed from `RemoveModelDialog` (trees B3). The dialog is deliberately
 * loud when the entry holds extracted data: the delete cascades through
 * every descendant instance, and that is not recoverable from the UI.
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
import {DEFAULT_ENTRY_NOUN} from '@/lib/extraction/entryKey';

// =================== INTERFACES ===================

interface RemoveEntryDialogProps {
  open: boolean;
  entryName: string;
  hasExtractedData: boolean;
  extractedFieldsCount?: number;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  /** Entry noun for `{{noun}}` copy interpolation (B-8 D6). */
  entryLabel?: string;
}

// =================== COMPONENT ===================

export function RemoveEntryDialog({
  open,
  entryName,
  hasExtractedData,
  extractedFieldsCount = 0,
  onConfirm,
  onCancel,
  entryLabel = DEFAULT_ENTRY_NOUN
}: RemoveEntryDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // {{noun}} resolves inline at each call site (D7); the bullet naming
  // the entry composes data (capitalized noun + quoted name).
  const nounCap = entryLabel.charAt(0).toUpperCase() + entryLabel.slice(1);

    // Confirmation handler
  const handleConfirm = async () => {
    setLoading(true);
    setError(null);

    extractionLogger.info('removeModelDialog', 'Starting model removal', {
      entryName,
      hasExtractedData,
      extractedFieldsCount,
    });

    const err = await onConfirm().then(() => null, (e: unknown) => e);

    if (err) {
      const errAny = err as any;
      extractionLogger.error('removeModelDialog', 'Failed to remove model', errAny, {
        entryName,
        hasExtractedData,
      });
      setError(
        errAny?.message ||
          t('extraction', 'removeModelError').replace('{{noun}}', entryLabel),
      );
    } else {
      extractionLogger.info('removeModelDialog', 'Model removed successfully', {entryName});
        // Dialog will be closed by parent component
    }

    // Always reset loading regardless of success/error
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && !loading && onCancel()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
              {t('extraction', 'removeModelTitle').replace('{{noun}}', entryLabel)}
          </DialogTitle>
          <DialogDescription>
              {t('extraction', 'removeModelDesc')
                  .replace('{{noun}}', entryLabel)
                  .replace('{{name}}', entryName)}
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
                      {t('extraction', 'removeModelWarningTitle').replace('{{noun}}', entryLabel)}
                  </p>
                  <p>
                      <strong>{extractedFieldsCount}</strong>{' '}
                      {t(
                          'extraction',
                          extractedFieldsCount === 1
                              ? 'removeModelFieldFilled'
                              : 'removeModelFieldsFilled',
                      ).replace('{{noun}}', entryLabel)}
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
                  {t('extraction', 'removeModelNoData').replace('{{noun}}', entryLabel)}
              </AlertDescription>
            </Alert>
          )}

            {/* Operation details */}
          <div className="bg-muted/40 rounded-lg p-4 border border-border/40">
            <p className="text-sm font-medium text-foreground mb-2">
                {t('extraction', 'removeModelWhatRemoved')}
            </p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-destructive">•</span>
                  <span>{nounCap} "{entryName}"</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-destructive">•</span>
                  <span>{t('extraction', 'removeModelSubsections').replace('{{noun}}', entryLabel)}</span>
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
            size="sm"
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={loading}
          >
              {t('common', 'cancel')}
          </Button>
          <Button
            size="sm"
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
                  {hasExtractedData
                      ? t('extraction', 'removeModelAnyway')
                      : t('extraction', 'removeModel').replace('{{noun}}', entryLabel)}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

