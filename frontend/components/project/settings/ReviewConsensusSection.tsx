/**
 * Review consensus section — project default + per-template overrides.
 *
 * Backend resolves `template > project > system_default` at Run creation
 * time and freezes the result on `Run.hitl_config_snapshot`. So
 * everything the user changes here only affects *new* Runs; the banner
 * up top makes that explicit.
 */

import { useEffect, useMemo, useState } from 'react';
import { Info, Layers, RotateCcw, ShieldCheck, Users } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsCard, SettingsSection } from '@/components/settings';
import { t } from '@/lib/copy';
import {
  useClearProjectHitlConfig,
  useProjectHitlConfig,
  useUpsertProjectHitlConfig,
} from '@/hooks/hitl/useHitlConfig';
import { useProjectMembers } from '@/hooks/hitl/useProjectMembers';
import { useHITLProjectTemplates } from '@/hooks/hitl/useHITLProjectTemplates';
import { useProjectMemberRole } from '@/hooks/useProjectMemberRole';
import type { HitlConfigPayload } from '@/services/hitlConfigService';

import { ConsensusConfigForm } from './ConsensusConfigForm';
import { TemplateConsensusOverride } from './TemplateConsensusOverride';

interface ReviewConsensusSectionProps {
  projectId: string;
}

export function ReviewConsensusSection({ projectId }: ReviewConsensusSectionProps) {
  const { isManager } = useProjectMemberRole(projectId);
  const projectConfig = useProjectHitlConfig(projectId);
  const upsertProject = useUpsertProjectHitlConfig(projectId);
  const clearProject = useClearProjectHitlConfig(projectId);
  const members = useProjectMembers(projectId);

  // We want both extraction and quality-assessment templates side by side.
  const extractionTemplates = useHITLProjectTemplates({
    projectId,
    kind: 'extraction',
  });
  const qaTemplates = useHITLProjectTemplates({
    projectId,
    kind: 'quality_assessment',
  });

  const allTemplates = useMemo(
    () =>
      [
        ...extractionTemplates.templates,
        ...qaTemplates.templates,
      ].sort((a, b) => a.name.localeCompare(b.name)),
    [extractionTemplates.templates, qaTemplates.templates],
  );

  const [draft, setDraft] = useState<HitlConfigPayload>({
    reviewer_count: 1,
    consensus_rule: 'unanimous',
    arbitrator_id: null,
  });

  useEffect(() => {
    if (projectConfig.data) {
      setDraft({
        reviewer_count: projectConfig.data.reviewer_count,
        consensus_rule: projectConfig.data.consensus_rule,
        arbitrator_id: projectConfig.data.arbitrator_id,
      });
    }
  }, [projectConfig.data]);

  const projectIsCustomized = projectConfig.data
    ? projectConfig.data.scope_kind === 'project'
    : false;

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
    extractionTemplates.loading || qaTemplates.loading;

  return (
    <SettingsSection
      title={t('consensus', 'sectionTitle')}
      description={t('consensus', 'sectionDesc')}
    >
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle className="text-[13px]">
          {t('consensus', 'runsBannerTitle')}
        </AlertTitle>
        <AlertDescription className="text-[12px] text-muted-foreground/80">
          {t('consensus', 'runsBannerBody')}
        </AlertDescription>
      </Alert>

      <SettingsCard
        title={t('consensus', 'projectDefaultTitle')}
        description={t('consensus', 'projectDefaultDesc')}
        icon={ShieldCheck}
      >
        {projectConfig.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-full max-w-md" />
          </div>
        ) : (
          <>
            {!projectIsCustomized && (
              <Alert variant="default" className="border-dashed">
                <Users className="h-4 w-4" />
                <AlertDescription className="text-[12px]">
                  {t('consensus', 'projectDefaultUsingSystem')}
                </AlertDescription>
              </Alert>
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
            <div className="flex items-center justify-between gap-2 pt-3 border-t border-border/40">
              <div>
                {projectIsCustomized && isManager && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearProject}
                    disabled={clearProject.isPending || upsertProject.isPending}
                    className="text-[12px] text-muted-foreground"
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                    {t('consensus', 'resetProjectDefault')}
                  </Button>
                )}
              </div>
              <Button
                size="sm"
                onClick={handleSaveProject}
                disabled={saveDisabled}
                className="text-[12px]"
              >
                {upsertProject.isPending
                  ? t('consensus', 'saving')
                  : t('consensus', 'saveProjectDefault')}
              </Button>
            </div>
          </>
        )}
      </SettingsCard>

      <SettingsCard
        title={t('consensus', 'templatesTitle')}
        description={t('consensus', 'templatesDesc')}
        icon={Layers}
      >
        {templatesLoading ? (
          <div className="text-[12px] text-muted-foreground py-3">
            {t('consensus', 'templatesLoading')}
          </div>
        ) : allTemplates.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-3">
            {t('consensus', 'templatesEmpty')}
          </div>
        ) : (
          <div className="space-y-2">
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
      </SettingsCard>
    </SettingsSection>
  );
}
