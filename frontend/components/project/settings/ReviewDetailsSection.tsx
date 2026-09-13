/**
 * Review details section — the review's prose fields (title, condition,
 * context, rationale, search strategy). The AI review question (PICOTS) is its
 * own section, `ReviewQuestionSection`, written through a manager-gated typed
 * PUT rather than this section's batched PostgREST draft.
 */

import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {SettingsGroup, SettingsPage, SettingsRow} from '@/components/settings';
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

export function ReviewDetailsSection({project, onChange}: ReviewDetailsSectionProps) {
    return (
        <SettingsPage>
            <SettingsGroup title={t('project', 'reviewCardGeneralTitle')}>
                <SettingsRow
                    label={t('project', 'reviewTitleLabel')}
                    htmlFor="review_title"
                    hint={t('project', 'reviewTitleHint')}
                >
                    {({describedBy}) => (
                        <Input
                            id="review_title"
                            variant="quiet"
                            value={project.review_title ?? ''}
                            onChange={(e) => onChange({review_title: e.target.value})}
                            placeholder={t('project', 'reviewTitlePlaceholder')}
                            aria-describedby={describedBy}
                        />
                    )}
                </SettingsRow>
                <SettingsRow
                    label={t('project', 'reviewConditionStudiedLabel')}
                    htmlFor="condition_studied"
                    hint={t('project', 'reviewConditionStudiedHint')}
                >
                    {({describedBy}) => (
                        <Input
                            id="condition_studied"
                            variant="quiet"
                            value={project.condition_studied ?? ''}
                            onChange={(e) => onChange({condition_studied: e.target.value})}
                            placeholder={t('project', 'reviewConditionStudiedPlaceholder')}
                            aria-describedby={describedBy}
                        />
                    )}
                </SettingsRow>
                <SettingsRow
                    label={t('project', 'reviewContextLabel')}
                    htmlFor="review_context"
                    hint={t('project', 'reviewContextHint')}
                    align="start"
                >
                    {({describedBy}) => (
                        <Textarea
                            id="review_context"
                            variant="quiet"
                            value={project.review_context ?? ''}
                            onChange={(e) => onChange({review_context: e.target.value})}
                            placeholder={t('project', 'reviewContextPlaceholder')}
                            rows={3}
                            aria-describedby={describedBy}
                            className="resize-none"
                        />
                    )}
                </SettingsRow>
                <SettingsRow
                    label={t('project', 'reviewRationaleLabel')}
                    htmlFor="review_rationale"
                    hint={t('project', 'reviewRationaleHint')}
                    align="start"
                >
                    {({describedBy}) => (
                        <Textarea
                            id="review_rationale"
                            variant="quiet"
                            value={project.review_rationale ?? ''}
                            onChange={(e) => onChange({review_rationale: e.target.value})}
                            placeholder={t('project', 'reviewRationalePlaceholder')}
                            rows={5}
                            aria-describedby={describedBy}
                            className="resize-none"
                        />
                    )}
                </SettingsRow>
            </SettingsGroup>

            <SettingsGroup title={t('project', 'reviewCardSearchTitle')}>
                <SettingsRow
                    label={t('project', 'reviewStrategyLabel')}
                    htmlFor="search_strategy"
                    hint={t('project', 'reviewStrategyHint')}
                    align="start"
                >
                    {({describedBy}) => (
                        <Textarea
                            id="search_strategy"
                            variant="quiet"
                            value={project.search_strategy ?? ''}
                            onChange={(e) => onChange({search_strategy: e.target.value})}
                            placeholder={t('project', 'reviewStrategyPlaceholder')}
                            rows={8}
                            aria-describedby={describedBy}
                            className="font-mono resize-none"
                        />
                    )}
                </SettingsRow>
            </SettingsGroup>
        </SettingsPage>
    );
}
