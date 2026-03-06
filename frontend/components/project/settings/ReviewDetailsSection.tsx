/**
 * Review details section — PICOTS, search strategy, rationale, context.
 */

import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Badge} from '@/components/ui/badge';
import {Separator} from '@/components/ui/separator';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '@/components/ui/accordion';
import {SettingsSection, SettingsField, SettingsCard} from '@/components/settings';
import {PICOTSItemEditor} from './PICOTSItemEditor';
import type {Project} from '@/types/project';
import {t} from '@/lib/copy';

export interface PICOTSItem {
  description?: string;
  inclusion?: string[];
  exclusion?: string[];
}

interface PICOTSTiming {
  prediction_moment?: PICOTSItem;
  prediction_horizon?: PICOTSItem;
}

export type PicotsConfig = {
    population?: PICOTSItem;
    index_models?: PICOTSItem;
    comparator_models?: PICOTSItem;
    outcomes?: PICOTSItem;
    timing?: PICOTSTiming;
    setting_and_intended_use?: PICOTSItem;
};

type ProjectShape = Pick<
    Project,
    | 'review_title'
    | 'condition_studied'
    | 'review_rationale'
    | 'search_strategy'
    | 'review_context'
    | 'review_type'
    | 'picots_config_ai_review'
>;

interface ReviewDetailsSectionProps {
    project: ProjectShape;
    onChange: (updates: Partial<ProjectShape>) => void;
}

const PICOTS_FIELDS: Array<{
    value: string;
    badge: string;
    label: string;
    fieldKey: string;
    infoTooltip: string;
    descriptionPlaceholder: string;
}> = [
    {
        value: 'population',
        badge: 'P',
        label: t('project', 'picotsPopulationLabel'),
        fieldKey: 'population',
        infoTooltip: t('project', 'picotsPopulationTooltip'),
        descriptionPlaceholder: t('project', 'picotsPopulationPlaceholder')
    },
    {
        value: 'index_models',
        badge: 'I',
        label: t('project', 'picotsIndexModelsLabel'),
        fieldKey: 'index_models',
        infoTooltip: t('project', 'picotsIndexModelsTooltip'),
        descriptionPlaceholder: t('project', 'picotsIndexModelsPlaceholder')
    },
    {
        value: 'comparator_models',
        badge: 'C',
        label: t('project', 'picotsComparatorsLabel'),
        fieldKey: 'comparator_models',
        infoTooltip: t('project', 'picotsComparatorsTooltip'),
        descriptionPlaceholder: t('project', 'picotsComparatorsPlaceholder')
    },
    {
        value: 'outcomes',
        badge: 'O',
        label: t('project', 'picotsOutcomesLabel'),
        fieldKey: 'outcomes',
        infoTooltip: t('project', 'picotsOutcomesTooltip'),
        descriptionPlaceholder: t('project', 'picotsOutcomesPlaceholder')
    },
    {
        value: 'setting',
        badge: 'S',
        label: t('project', 'picotsSettingLabel'),
        fieldKey: 'setting_and_intended_use',
        infoTooltip: t('project', 'picotsSettingTooltip'),
        descriptionPlaceholder: t('project', 'picotsSettingPlaceholder')
    },
];

export function ReviewDetailsSection({ project, onChange }: ReviewDetailsSectionProps) {
    const picots: PicotsConfig = (project.picots_config_ai_review as PicotsConfig) || {};
  const isPredictiveModel = project.review_type === 'predictive_model';

    const updatePICOTSField = (mainField: string, subField: string, value: unknown) => {
    const newPicots = { ...picots };

    if (mainField.includes('.')) {
      const [parent, child] = mainField.split('.');
        const parentKey = parent as keyof PicotsConfig;
        const parentVal = newPicots[parentKey] as Record<string, unknown> | undefined;
        (newPicots as Record<string, unknown>)[parent] = {
            ...parentVal,
        [child]: {
            ...((parentVal?.[child] as object) || {}),
            [subField]: value,
        },
      };
    } else {
        (newPicots as Record<string, unknown>)[mainField] = {
            ...((newPicots[mainField as keyof PicotsConfig] as object) || {}),
            [subField]: value,
      };
    }
    onChange({ picots_config_ai_review: newPicots });
  };

  const addArrayItem = (mainField: string, arrayField: 'inclusion' | 'exclusion', value: string) => {
    if (!value.trim()) return;
      const current = (picots[mainField as keyof PicotsConfig] as PICOTSItem) || {};
    const currentArray = current[arrayField] || [];
    updatePICOTSField(mainField, arrayField, [...currentArray, value.trim()]);
  };

    const removeArrayItem = (
        mainField: string,
        arrayField: 'inclusion' | 'exclusion',
        index: number
    ) => {
        const current = (picots[mainField as keyof PicotsConfig] as PICOTSItem) || {};
    const currentArray = current[arrayField] || [];
    updatePICOTSField(mainField, arrayField, currentArray.filter((_, i) => i !== index));
  };

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

      {isPredictiveModel && (
          <SettingsCard
              title={t('project', 'reviewCardPicotsTitle')}
              description={t('project', 'reviewCardPicotsDesc')}
          >
              <div className="mb-2">
                  <Badge variant="secondary" className="text-[11px]">
                      {t('project', 'reviewPredictiveModelsBadge')}
                  </Badge>
              </div>
              <Accordion type="multiple" className="w-full">
                  {PICOTS_FIELDS.map((field) => (
                      <AccordionItem key={field.value} value={field.value}>
                          <AccordionTrigger className="text-[13px] font-medium py-2 hover:no-underline">
                              <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-[11px]">
                                      {field.badge}
                                  </Badge>
                                  {field.label}
                              </div>
                          </AccordionTrigger>
                          <AccordionContent>
                              <PICOTSItemEditor
                                  label={field.label}
                                  fieldKey={field.fieldKey}
                                  data={(picots[field.fieldKey as keyof PicotsConfig] as PICOTSItem) || {}}
                                  infoTooltip={field.infoTooltip}
                                  descriptionPlaceholder={field.descriptionPlaceholder}
                                  onUpdate={updatePICOTSField}
                                  onAddItem={addArrayItem}
                                  onRemoveItem={removeArrayItem}
                              />
                          </AccordionContent>
                      </AccordionItem>
                  ))}

            <AccordionItem value="timing">
                <AccordionTrigger className="text-[13px] font-medium py-2 hover:no-underline">
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[11px]">
                        T
                    </Badge>
                    {t('project', 'reviewTimingLabel')}
                </div>
              </AccordionTrigger>
                <AccordionContent className="space-y-4">
                    <div className="space-y-3">
                        <h4 className="text-[13px] font-medium">{t('project', 'reviewPredictionMomentLabel')}</h4>
                  <PICOTSItemEditor
                      label={t('project', 'reviewPredictionMomentLabel')}
                    fieldKey="timing.prediction_moment"
                    data={(picots.timing?.prediction_moment as PICOTSItem) || {}}
                      infoTooltip={t('project', 'reviewPredictionMomentTooltip')}
                      descriptionPlaceholder={t('project', 'reviewPredictionMomentPlaceholder')}
                    onUpdate={updatePICOTSField}
                    onAddItem={addArrayItem}
                    onRemoveItem={removeArrayItem}
                  />
                </div>
                <Separator />
                    <div className="space-y-3">
                        <h4 className="text-[13px] font-medium">{t('project', 'reviewPredictionHorizonLabel')}</h4>
                  <PICOTSItemEditor
                      label={t('project', 'reviewPredictionHorizonLabel')}
                    fieldKey="timing.prediction_horizon"
                    data={(picots.timing?.prediction_horizon as PICOTSItem) || {}}
                      infoTooltip={t('project', 'reviewPredictionHorizonTooltip')}
                      descriptionPlaceholder={t('project', 'reviewPredictionHorizonPlaceholder')}
                    onUpdate={updatePICOTSField}
                    onAddItem={addArrayItem}
                    onRemoveItem={removeArrayItem}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          </SettingsCard>
      )}
      </SettingsSection>
  );
}
