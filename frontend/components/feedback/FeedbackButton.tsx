/**
 * Sidebar-footer bug button — opens the feedback dialog. Sits next to the
 * user menu and composes IconButton, so it stays identical to every
 * other chrome icon button in size, hover, and focus.
 *
 * The dialog is mounted lazily: it pulls auth + mutation hooks, and the
 * footer renders on every project page.
 */

import {useState} from 'react';
import {Bug} from 'lucide-react';
import {IconButton} from '@/components/patterns/IconButton';
import {FeedbackDialog} from './FeedbackDialog';
import {t} from '@/lib/copy';

export function FeedbackButton() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <IconButton
        label={t('navigation', 'sendFeedback')}
        onClick={() => setDialogOpen(true)}
        icon={<Bug strokeWidth={1.5} aria-hidden="true" />}
      />

      {dialogOpen && <FeedbackDialog open onOpenChange={setDialogOpen} />}
    </>
  );
}
