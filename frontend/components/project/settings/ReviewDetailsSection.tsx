/**
 * Review details section — the review's prose fields (title, condition,
 * context, rationale, search strategy). The AI review question (PICOTS) is its
 * own section, `ReviewQuestionSection`, written through a manager-gated typed
 * PUT rather than this section's batched PostgREST draft.
 */

import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {SettingsSection, SettingsField, SettingsCard} from '@/components/settings';
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

interface ReviewDetailsSectionProps {
    project: ProjectShape;
    onChange: (updates: Partial<ProjectShape>) => void;
}

export function ReviewDetailsSection({ project, onChange }: ReviewDetailsSectionProps) {
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
      </SettingsSection>
  );
}
