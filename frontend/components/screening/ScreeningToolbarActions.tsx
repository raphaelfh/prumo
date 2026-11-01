/**
 * The title/abstract toolbar's write actions: the PubMed import (every member
 * except a viewer), enrolment (manager) and "Start screening" (a reviewer
 * with records left). Which ones render is the workspace's call.
 */
import {useState} from 'react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
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

/** Enrolls every not-yet-enrolled project article (empty body) and toasts the outcome. */
export function EnrollAllButton({projectId, label, disabled = false, size, className}: EnrollAllButtonProps) {
  const enroll = useEnrollArticles(projectId);
  const onClick = () =>
    enroll.mutate(
      {},
      {
        onSuccess: (result) =>
          toast.success(t('screening', 'enrolledToast').replace('{{n}}', String(result.enrolled))),
        onError: (error) => toast.error(screeningErrorMessage(error)),
      },
    );
  return (
    <Button size={size} className={className} onClick={onClick} disabled={disabled || enroll.isPending}>
      {label}
    </Button>
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
