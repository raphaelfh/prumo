/**
 * The title/abstract toolbar's write actions: the PubMed import (every member
 * except a viewer), enrolment (manager) and "Start screening" (a reviewer
 * with records left). Which ones render is the workspace's call.
 */
import {useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';
import {useSearchParams} from 'react-router';
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
import {Button} from '@/components/ui/button';
import {duplicatesQueryOptions} from '@/hooks/screening/useDuplicates';
import {useEnrollArticles} from '@/hooks/screening/useScreeningConfig';
import {t} from '@/lib/copy';
import {screeningErrorMessage} from '@/lib/screening/errors';

import {PubMedImportDialog} from './PubMedImportDialog';

interface EnrollAllButtonProps {
  projectId: string;
  label: string;
  disabled?: boolean;
  size?: 'sm' | 'default';
  className?: string;
}

/**
 * Enrolls every not-yet-enrolled project article (empty body) and toasts the
 * outcome. Open duplicate pairs get one "Enroll anyway?" prompt first; the
 * check is advisory, so a failed duplicates read enrolls directly.
 */
export function EnrollAllButton({projectId, label, disabled = false, size, className}: EnrollAllButtonProps) {
  const enroll = useEnrollArticles(projectId);
  const queryClient = useQueryClient();
  const [, setSearchParams] = useSearchParams();
  const [openPairs, setOpenPairs] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  const runEnroll = () =>
    enroll.mutate(
      {},
      {
        onSuccess: (result) =>
          toast.success(t('screening', 'enrolledToast').replace('{{n}}', String(result.enrolled))),
        onError: (error) => toast.error(screeningErrorMessage(error)),
      },
    );

  const onClick = () => {
    setChecking(true);
    queryClient
      .fetchQuery({...duplicatesQueryOptions(projectId), staleTime: 0})
      .then(
        (read) => read.open.length,
        () => 0,
      )
      .then((open) => {
        setChecking(false);
        if (open > 0) setOpenPairs(open);
        else runEnroll();
      });
  };

  const reviewDuplicates = () => {
    setOpenPairs(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('screeningTab', 'duplicates');
        return next;
      },
      {replace: true},
    );
  };

  return (
    <>
      <Button
        size={size}
        className={className}
        onClick={onClick}
        disabled={disabled || checking || enroll.isPending}
      >
        {label}
      </Button>
      <AlertDialog open={openPairs !== null} onOpenChange={(open) => !open && setOpenPairs(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('duplicates', 'enrollAnywayTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {openPairs === 1
                ? t('duplicates', 'enrollAnywayBodyOne')
                : t('duplicates', 'enrollAnywayBody').replace('{{n}}', String(openPairs ?? 0))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={reviewDuplicates}>{t('duplicates', 'reviewDuplicates')}</AlertDialogCancel>
            <AlertDialogAction onClick={runEnroll}>{t('duplicates', 'enrollAnywayConfirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface PubMedImportButtonProps {
  projectId: string;
  canManage: boolean;
  className?: string;
}

/** Any project member may import (import role is membership); the dialog owns the rest. */
export function PubMedImportButton({projectId, canManage, className}: PubMedImportButtonProps) {
  const [importOpen, setImportOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className={className} onClick={() => setImportOpen(true)}>
        {t('screening', 'importOpen')}
      </Button>
      <PubMedImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        projectId={projectId}
        canManage={canManage}
      />
    </>
  );
}

/** Opens the first To screen record in queue order, panel maximized. */
export function StartScreeningButton({disabled = false, onStart}: {disabled?: boolean; onStart: () => void}) {
  return (
    <Button size="sm" className="shrink-0" onClick={onStart} disabled={disabled}>
      {t('screening', 'startScreening')}
    </Button>
  );
}
