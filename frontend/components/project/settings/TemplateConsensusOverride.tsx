/**
 * One-row template editor for the Per-template overrides list.
 *
 * Renders a header with the template name + an "Inherits / Overridden"
 * badge, and an expandable inline form. Saving calls the
 * template-scoped upsert; "Remove override" deletes the row and falls
 * back to the project default.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsActions } from '@/components/settings';
import { t } from '@/lib/copy';
import {
  useClearTemplateHitlConfig,
  useTemplateHitlConfig,
  useUpsertTemplateHitlConfig,
} from '@/hooks/hitl/useHitlConfig';
import type { ProjectMemberSummary } from '@/hooks/hitl/useProjectMembers';
import type { ProjectTemplate } from '@/hooks/hitl/useHITLProjectTemplates';
import type { HitlConfigPayload } from '@/services/hitlConfigService';

import { ConsensusConfigForm } from './ConsensusConfigForm';

interface TemplateConsensusOverrideProps {
  projectId: string;
  template: ProjectTemplate;
  members: ProjectMemberSummary[];
  membersLoading: boolean;
  canEdit: boolean;
}

export function TemplateConsensusOverride({
  projectId,
  template,
  members,
  membersLoading,
  canEdit,
}: TemplateConsensusOverrideProps) {
  const [expanded, setExpanded] = useState(false);
  const config = useTemplateHitlConfig(projectId, template.id);
  const upsert = useUpsertTemplateHitlConfig(projectId, template.id);
  const clear = useClearTemplateHitlConfig(projectId, template.id);

  const [draft, setDraft] = useState<HitlConfigPayload>(() =>
    config.data
      ? {
          reviewer_count: config.data.reviewer_count,
          consensus_rule: config.data.consensus_rule,
          arbitrator_id: config.data.arbitrator_id,
        }
      : {
          reviewer_count: 1,
          consensus_rule: 'unanimous',
          arbitrator_id: null,
        },
  );

  // Re-hydrate the draft when the server config (re)loads — adjusted during
  // render instead of via effect.
  const [prevConfigData, setPrevConfigData] = useState(config.data);
  if (config.data !== prevConfigData) {
    setPrevConfigData(config.data);
    if (config.data) {
      setDraft({
        reviewer_count: config.data.reviewer_count,
        consensus_rule: config.data.consensus_rule,
        arbitrator_id: config.data.arbitrator_id,
      });
    }
  }

  const isOverridden = config.data ? !config.data.inherited : false;
  const isArbitratorIncomplete =
    draft.consensus_rule === 'arbitrator' && !draft.arbitrator_id;
  const saveDisabled =
    !canEdit ||
    upsert.isPending ||
    isArbitratorIncomplete ||
    config.isLoading;

  const handleSave = async () => {
    try {
      await upsert.mutateAsync(draft);
      toast.success(t('consensus', 'saveSuccessTemplate'));
    } catch (err) {
      toast.error(
        `${t('consensus', 'saveError')}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  };

  const handleClear = async () => {
    try {
      await clear.mutateAsync();
      toast.success(t('consensus', 'resetSuccessTemplate'));
      setExpanded(false);
    } catch (err) {
      toast.error(
        `${t('consensus', 'resetError')}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  };

  return (
    <div role="listitem">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        )}
        <span className="truncate font-medium">{template.name}</span>
        {template.framework && (
          <span className="truncate text-muted-foreground">· {template.framework}</span>
        )}
        {config.isLoading ? (
          <Skeleton className="ml-auto h-5 w-24 shrink-0" />
        ) : (
          <Badge variant={isOverridden ? 'default' : 'outline'} className="ml-auto shrink-0 text-[11px]">
            {isOverridden
              ? t('consensus', 'templatesOverriddenBadge')
              : t('consensus', 'templatesInheritsBadge')}
          </Badge>
        )}
      </button>

      {expanded && (
        <div className="space-y-1 pb-2">
          {config.isLoading ? (
            <>
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </>
          ) : (
            <ConsensusConfigForm
              value={draft}
              onChange={setDraft}
              members={members}
              membersLoading={membersLoading}
              disabled={!canEdit || upsert.isPending || clear.isPending}
            />
          )}

          {canEdit && (
            <SettingsActions>
              {isOverridden && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClear}
                  disabled={clear.isPending || upsert.isPending}
                >
                  <X className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
                  {t('consensus', 'templatesRemoveOverride')}
                </Button>
              )}
              <Button size="sm" onClick={handleSave} disabled={saveDisabled}>
                {upsert.isPending ? t('consensus', 'saving') : t('consensus', 'save')}
              </Button>
            </SettingsActions>
          )}
        </div>
      )}
    </div>
  );
}
