/**
 * Review consensus section — project default + per-template overrides.
 *
 * Backend resolves `template > project > system_default` at Run creation
 * time and freezes the result on `Run.hitl_config_snapshot`. So
 * everything the user changes here only affects *new* Runs; the intro
 * line makes that explicit.
 */

import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { SettingsActions, SettingsGroup, SettingsPage, SettingsRow } from '@/components/settings';
import { t } from '@/lib/copy';
import {
  useClearProjectHitlConfig,
  useProjectHitlConfig,
  useUpsertProjectHitlConfig,
} from '@/hooks/hitl/useHitlConfig';
import { useManagerReviewVisibility } from '@/hooks/hitl/useManagerReviewVisibility';
import { useProjectMembers } from '@/hooks/hitl/useProjectMembers';
import { useProjectTemplates } from '@/hooks/hitl/useProjectTemplates';
import { useProjectMemberRole } from '@/hooks/useProjectMemberRole';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useComparisonPermissions } from '@/hooks/shared/useComparisonPermissions';
import type { HitlConfigPayload } from '@/services/hitlConfigService';

import { ConsensusConfigForm } from './ConsensusConfigForm';
import { TemplateConsensusOverride } from './TemplateConsensusOverride';

interface ReviewConsensusSectionProps {
  projectId: string;
}

export function ReviewConsensusSection({
  projectId,
}: ReviewConsensusSectionProps) {
  const { isManager } = useProjectMemberRole(projectId);
  // Self-source the per-kind manager-visibility setting (same hook the QA
  // configuration uses), so both toggle surfaces share one source of truth
  // instead of one reading the hook and one a raw project.settings cast.
  const { userId } = useCurrentUser();
  const visibilityPerms = useComparisonPermissions(projectId, userId ?? '', 'extraction');
  const visibility = useManagerReviewVisibility(projectId, 'extraction', visibilityPerms.canSeeOthers);
  const projectConfig = useProjectHitlConfig(projectId);
  const upsertProject = useUpsertProjectHitlConfig(projectId);
  const clearProject = useClearProjectHitlConfig(projectId);
  const members = useProjectMembers(projectId);

  // We want both extraction and quality-assessment templates side by side.
  const extractionTemplates = useProjectTemplates({
    projectId,
    kind: 'extraction',
  });
  const qaTemplates = useProjectTemplates({
    projectId,
    kind: 'quality_assessment',
  });

  const allTemplates = [
    ...(extractionTemplates.data ?? []),
    ...(qaTemplates.data ?? []),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const [draft, setDraft] = useState<HitlConfigPayload>(() =>
    projectConfig.data
      ? {
          reviewer_count: projectConfig.data.reviewer_count,
          consensus_rule: projectConfig.data.consensus_rule,
          arbitrator_id: projectConfig.data.arbitrator_id,
        }
      : {
          reviewer_count: 1,
          consensus_rule: 'unanimous',
          arbitrator_id: null,
        },
  );

  // Re-hydrate the draft when the server config (re)loads — adjusted during
  // render instead of via effect.
  const [prevConfigData, setPrevConfigData] = useState(projectConfig.data);
  if (projectConfig.data !== prevConfigData) {
    setPrevConfigData(projectConfig.data);
    if (projectConfig.data) {
      setDraft({
        reviewer_count: projectConfig.data.reviewer_count,
        consensus_rule: projectConfig.data.consensus_rule,
        arbitrator_id: projectConfig.data.arbitrator_id,
      });
    }
  }

  const projectIsCustomized = projectConfig.data
    ? projectConfig.data.scope_kind === 'project'
    : false;

  // The fallback is named only once the config has loaded cleanly and says so.
  const showSystemDefault =
    !projectConfig.isLoading &&
    !projectConfig.isError &&
    projectConfig.data !== undefined &&
    projectConfig.data.scope_kind !== 'project';

  const isArbitratorIncomplete =
    draft.consensus_rule === 'arbitrator' && !draft.arbitrator_id;
  const saveDisabled =
    !isManager ||
    upsertProject.isPending ||
    isArbitratorIncomplete ||
    projectConfig.isLoading;

  const handleSaveProject = async () => {
    try {
      await upsertProject.mutateAsync(draft);
      toast.success(t('consensus', 'saveSuccessProject'));
    } catch (err) {
      toast.error(
        `${t('consensus', 'saveError')}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  };

  const handleClearProject = async () => {
    try {
      await clearProject.mutateAsync();
      toast.success(t('consensus', 'resetSuccessProject'));
    } catch (err) {
      toast.error(
        `${t('consensus', 'resetError')}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  };

  const templatesLoading =
    extractionTemplates.isLoading || qaTemplates.isLoading;

  return (
    <SettingsPage
      intro={
        <>
          <span className="text-foreground">{t('consensus', 'runsBannerTitle')}</span>{' '}
          {t('consensus', 'runsBannerBody')}
        </>
      }
    >
      <SettingsGroup title={t('consensus', 'projectDefaultTitle')} hint={t('consensus', 'projectDefaultDesc')}>
        {projectConfig.isLoading ? (
          <>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </>
        ) : (
          <>
            {showSystemDefault && (
              <SettingsRow label={t('consensus', 'currentDefaultLabel')}>
                <p className="px-2 text-[13px] text-muted-foreground">{t('consensus', 'currentSystemDefault')}</p>
              </SettingsRow>
            )}
            <ConsensusConfigForm
              value={draft}
              onChange={setDraft}
              members={members.data ?? []}
              membersLoading={members.isLoading}
              disabled={
                !isManager || upsertProject.isPending || clearProject.isPending
              }
            />
            <SettingsActions>
              {projectIsCustomized && isManager && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearProject}
                  disabled={clearProject.isPending || upsertProject.isPending}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
                  {t('consensus', 'resetProjectDefault')}
                </Button>
              )}
              <Button size="sm" onClick={handleSaveProject} disabled={saveDisabled}>
                {upsertProject.isPending
                  ? t('consensus', 'saving')
                  : t('consensus', 'saveProjectDefault')}
              </Button>
            </SettingsActions>
          </>
        )}
      </SettingsGroup>

      {visibilityPerms.loading ? null : (
        <SettingsGroup>
          <SettingsRow
            label={t('consensus', 'managerVisibilityLabel')}
            htmlFor="manager-visibility-extraction"
            hint={t('consensus', 'managerVisibilityHint')}
          >
            {({ describedBy }) => (
              <Switch
                id="manager-visibility-extraction"
                checked={visibility.checked}
                disabled={!visibilityPerms.canManageBlindMode || visibility.saving}
                onCheckedChange={visibility.onToggle}
                aria-describedby={describedBy}
              />
            )}
          </SettingsRow>
        </SettingsGroup>
      )}

      <SettingsGroup title={t('consensus', 'templatesTitle')} hint={t('consensus', 'templatesDesc')}>
        {templatesLoading ? (
          <p className="text-[13px] text-muted-foreground">{t('consensus', 'templatesLoading')}</p>
        ) : allTemplates.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t('consensus', 'templatesEmpty')}</p>
        ) : (
          <div role="list" className="space-y-0.5">
            {allTemplates.map((template) => (
              <TemplateConsensusOverride
                key={template.id}
                projectId={projectId}
                template={template}
                members={members.data ?? []}
                membersLoading={members.isLoading}
                canEdit={isManager}
              />
            ))}
          </div>
        )}
      </SettingsGroup>
    </SettingsPage>
  );
}
