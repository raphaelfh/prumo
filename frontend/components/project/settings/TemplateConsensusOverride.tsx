/**
 * One-row template editor for the Per-template overrides list.
 *
 * Renders a header with the template name + an "Inherits / Overridden"
 * badge, and an expandable inline form. Saving calls the
 * template-scoped upsert; "Remove override" deletes the row and falls
 * back to the project default.
 */

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
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

  const [draft, setDraft] = useState<HitlConfigPayload>({
    reviewer_count: 1,
    consensus_rule: 'unanimous',
    arbitrator_id: null,
  });

  useEffect(() => {
    if (config.data) {
      setDraft({
        reviewer_count: config.data.reviewer_count,
        consensus_rule: config.data.consensus_rule,
        arbitrator_id: config.data.arbitrator_id,
      });
    }
  }, [config.data]);

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
    <div className="border border-border/40 rounded-md">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'w-full flex items-center justify-between gap-3 px-3 py-2.5',
          'text-left text-[13px] hover:bg-muted/40 transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20',
          expanded && 'border-b border-border/40',
        )}
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2 min-w-0">
          {expanded ? (
            <ChevronDown className="h-4 w-4 flex-shrink-0" strokeWidth={1.5} />
          ) : (
            <ChevronRight className="h-4 w-4 flex-shrink-0" strokeWidth={1.5} />
          )}
          <span className="font-medium truncate">{template.name}</span>
          {template.framework && (
            <span className="text-muted-foreground/60 truncate">
              · {template.framework}
            </span>
          )}
        </span>
        {config.isLoading ? (
          <Skeleton className="h-5 w-24" />
        ) : (
          <Badge variant={isOverridden ? 'default' : 'outline'} className="text-[11px] flex-shrink-0">
            {isOverridden
              ? t('consensus', 'templatesOverriddenBadge')
              : t('consensus', 'templatesInheritsBadge')}
          </Badge>
        )}
      </button>

      {expanded && (
        <div className="p-4 space-y-4">
          {config.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full max-w-md" />
              <Skeleton className="h-9 w-full max-w-md" />
            </div>
          ) : (
            <ConsensusConfigForm
              value={draft}
              onChange={setDraft}
              members={members}
              membersLoading={membersLoading}
              disabled={!canEdit || upsert.isPending || clear.isPending}
            />
          )}

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
            <div>
              {isOverridden && canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClear}
                  disabled={clear.isPending || upsert.isPending}
                  className="text-[12px] text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                  {t('consensus', 'templatesRemoveOverride')}
                </Button>
              )}
            </div>
            {canEdit && (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saveDisabled}
                className="text-[12px]"
              >
                {upsert.isPending ? t('consensus', 'saving') : t('consensus', 'save')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
