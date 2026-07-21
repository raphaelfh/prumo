/**
 * Destructive confirmation for sending a consensus-stage article back to
 * Extraction (arbitrator-only). Copy adapts to how much consensus work will be
 * discarded: `resolvedCount > 0` warns about the discard, `=== 0` is the clean
 * "opened by mistake" path. Modelled on DeleteFieldConfirm. See ADR-0017.
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
import { AlertTriangle, Loader2 } from 'lucide-react';
import { t } from '@/lib/copy';

interface ReopenExtractionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Distinct coords with a consensus decision — the number of resolutions discarded. */
  resolvedCount: number;
  onConfirm: () => void;
  pending?: boolean;
}

export function ReopenExtractionDialog({
  open,
  onOpenChange,
  resolvedCount,
  onConfirm,
  pending = false,
}: ReopenExtractionDialogProps) {
  const hasDiscard = resolvedCount > 0;
  const body = hasDiscard
    ? t('extraction', 'reopenExtractionBodyDiscard').replace('{{count}}', String(resolvedCount))
    : t('extraction', 'reopenExtractionBodyClean');
  const confirmLabel = hasDiscard
    ? t('extraction', 'reopenExtractionConfirmDiscard')
    : t('extraction', 'reopenExtractionConfirmClean');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            {t('extraction', 'reopenExtractionTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('common', 'cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={pending}
            className={hasDiscard ? 'bg-destructive hover:bg-destructive/90' : undefined}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
