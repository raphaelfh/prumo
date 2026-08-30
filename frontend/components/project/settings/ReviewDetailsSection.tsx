/**
 * Review details section — the review's prose fields, plus a read-only summary
 * of the AI review question (PICOTS).
 *
 * PICOTS is NOT edited here any more. It moved to `PicotsEditDialog`, which
 * writes through a manager-gated typed PUT. Two reasons, both defects rather
 * than tidiness:
 *
 *   - This section fed `ProjectSettings`' batched draft, and `saveProjectSettings`
 *     PATCHes every column in that draft on save. A client holding a stale
 *     snapshot could therefore write its copy of `picots_config_ai_review` back
 *     over a newer value — including the one migration 0063 had just flattened.
 *   - That save issues `.update()` with no `.select()`, so an RLS-filtered write
 *     matches zero rows and returns NO error. A reviewer editing PICOTS here got
 *     a success toast and lost the edit on reload.
 *
 * The dotted-path helpers that used to live here went with it. They were also
 * quietly lossy: the array handlers looked up `picots['timing.prediction_moment']`,
 * a key that never existed, so every criterion added to a Timing slot replaced
 * the list instead of appending to it.
 */

import {useState} from 'react';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Button} from '@/components/ui/button';
import {SettingsSection, SettingsField, SettingsCard} from '@/components/settings';
import {PicotsEditDialog} from '../PicotsEditDialog';
import {useAiContext} from '@/hooks/project/useAiContext';
import {useProjectMemberRole} from '@/hooks/useProjectMemberRole';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import type {Project} from '@/types/project';
import {t} from '@/lib/copy';

type ProjectShape = Pick<
    Project,
    | 'review_title'
    | 'condition_studied'
    | 'review_rationale'
    | 'search_strategy'
    | 'review_context'
    | 'review_type'
>;

/** Mirrors the backend's ``_SLOT_KEYS`` — the count is of the same six slots. */
const SLOT_KEYS = [
    'population',
    'index_models',
    'comparator_models',
    'outcomes',
    'timing',
    'setting_and_intended_use',
] as const;

interface ReviewDetailsSectionProps {
    projectId: string;
    project: ProjectShape;
    onChange: (updates: Partial<ProjectShape>) => void;
}

export function ReviewDetailsSection({ projectId, project, onChange }: ReviewDetailsSectionProps) {
    const [picotsOpen, setPicotsOpen] = useState(false);
    const {data: aiContext} = useAiContext(projectId);
    const {isManager} = useProjectMemberRole(projectId);
    const filled = SLOT_KEYS.filter(
        (key) => (aiContext?.picots as Record<string, {description?: string}> | undefined)?.[key]
            ?.description,
    ).length;


  return (
      <SettingsSection
          title={t('project', 'reviewSectionTitle')}
          description={t('project', 'reviewSectionDesc')}
      >
          <SettingsCard
              title={t('project', 'reviewCardGeneralTitle')}
              description={t('project', 'reviewCardGeneralDesc')}
          >
              <div className="space-y-4">
                  <SettingsField
                      label={t('project', 'reviewTitleLabel')}
                      htmlFor="review_title"
                      hint={t('project', 'reviewTitleHint')}
                  >
            <Input
              id="review_title"
              value={project.review_title ?? ''}
              onChange={(e) => onChange({ review_title: e.target.value })}
              placeholder={t('project', 'reviewTitlePlaceholder')}
              className="text-[13px] h-9"
            />
                  </SettingsField>
                  <SettingsField
                      label={t('project', 'reviewConditionStudiedLabel')}
                      htmlFor="condition_studied"
                      hint={t('project', 'reviewConditionStudiedHint')}
                  >
            <Input
              id="condition_studied"
              value={project.condition_studied ?? ''}
              onChange={(e) => onChange({ condition_studied: e.target.value })}
              placeholder={t('project', 'reviewConditionStudiedPlaceholder')}
              className="text-[13px] h-9"
            />
                  </SettingsField>
                  <SettingsField
                      label={t('project', 'reviewContextLabel')}
                      htmlFor="review_context"
                      hint={t('project', 'reviewContextHint')}
                  >
            <Textarea
              id="review_context"
              value={project.review_context ?? ''}
              onChange={(e) => onChange({ review_context: e.target.value })}
              placeholder={t('project', 'reviewContextPlaceholder')}
              rows={3}
              className="resize-none text-[13px]"
            />
                  </SettingsField>
                  <SettingsField
                      label={t('project', 'reviewRationaleLabel')}
                      htmlFor="review_rationale"
                      hint={t('project', 'reviewRationaleHint')}
                  >
            <Textarea
              id="review_rationale"
              value={project.review_rationale ?? ''}
              onChange={(e) => onChange({ review_rationale: e.target.value })}
              placeholder={t('project', 'reviewRationalePlaceholder')}
              rows={5}
              className="resize-none text-[13px]"
            />
                  </SettingsField>
              </div>
          </SettingsCard>

          <SettingsCard
              title={t('project', 'reviewCardSearchTitle')}
              description={t('project', 'reviewCardSearchDesc')}
          >
              <SettingsField
                  label={t('project', 'reviewStrategyLabel')}
                  htmlFor="search_strategy"
                  hint={t('project', 'reviewStrategyHint')}
              >
          <Textarea
            id="search_strategy"
            value={project.search_strategy ?? ''}
            onChange={(e) => onChange({ search_strategy: e.target.value })}
            placeholder={t('project', 'reviewStrategyPlaceholder')}
            rows={8}
            className="font-mono text-[13px] resize-none"
          />
              </SettingsField>
          </SettingsCard>

      <SettingsCard
          title={t('aiContext', 'sectionTitle')}
          description={t('aiContext', 'sectionDesc')}
      >
          <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                  {aiContext?.preview ? (
                      <pre className="max-h-40 overflow-auto text-xs whitespace-pre-wrap text-muted-foreground">
                          {aiContext.preview}
                      </pre>
                  ) : (
                      <p className="text-[13px] text-muted-foreground">
                          {t('aiContext', 'summaryEmpty')}
                      </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                      {t('aiContext', 'filledCountFormat')
                          .replace('{{filled}}', String(filled))
                          .replace('{{total}}', String(SLOT_KEYS.length))}
                      {aiContext && aiContext.picots_enabled === false
                          ? ` — ${t('aiContext', 'disabledNotice')}`
                          : ''}
                  </p>
              </div>
              <TooltipProvider>
                  <Tooltip>
                      <TooltipTrigger asChild>
                          <span tabIndex={isManager ? -1 : 0}>
                              <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={!isManager}
                                  onClick={() => setPicotsOpen(true)}
                              >
                                  {t('aiContext', 'editAction')}
                              </Button>
                          </span>
                      </TooltipTrigger>
                      {!isManager && (
                          <TooltipContent>{t('aiContext', 'managerOnly')}</TooltipContent>
                      )}
                  </Tooltip>
              </TooltipProvider>
          </div>
      </SettingsCard>

      <PicotsEditDialog
          projectId={projectId}
          open={picotsOpen}
          onOpenChange={setPicotsOpen}
      />
      </SettingsSection>
  );
}
