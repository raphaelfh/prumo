/**
 * Project → Configuration → Review question. The review question used to be
 * a dialog opened from a card in Review details; it is configuration, so it
 * is a section of the configuration view (spec 2026-09-13 §4.2). Flat groups
 * under one intro line (spec 2026-09-13 borderless density pass §4.3).
 */
import {SettingsGroup, SettingsPage} from '@/components/settings';
import {useProjectMemberRole} from '@/hooks/useProjectMemberRole';
import {t} from '@/lib/copy';

import {PicotsPane, PicotsPreview} from '../PicotsPane';

interface ReviewQuestionSectionProps {
  projectId: string;
  onDirtyChange: (dirty: boolean) => void;
}

export function ReviewQuestionSection({projectId, onDirtyChange}: ReviewQuestionSectionProps) {
  const {isManager} = useProjectMemberRole(projectId);
  return (
    <SettingsPage intro={t('aiContext', 'sectionDesc')}>
      {isManager ? (
        <PicotsPane projectId={projectId} onDirtyChange={onDirtyChange} />
      ) : (
        <SettingsGroup>
          <p className="text-[13px] text-muted-foreground">{t('aiContext', 'managerOnly')}</p>
          <PicotsPreview projectId={projectId} />
        </SettingsGroup>
      )}
    </SettingsPage>
  );
}
