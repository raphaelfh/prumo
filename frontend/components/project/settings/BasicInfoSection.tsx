/**
 * Basic project info section — name, description, review type — as one
 * untitled group of label/value rows (spec 2026-09-13 §4.3).
 */

import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Badge} from '@/components/ui/badge';
import {SettingsGroup, SettingsPage, SettingsRow} from '@/components/settings';
import type {Project, ReviewType} from '@/types/project';
import {REVIEW_TYPES} from '@/types/project';
import {t} from '@/lib/copy';

interface BasicInfoSectionProps {
    project: Pick<Project, 'name' | 'description' | 'review_type'>;
    onChange: (updates: Partial<Pick<Project, 'name' | 'description' | 'review_type'>>) => void;
}

export function BasicInfoSection({project, onChange}: BasicInfoSectionProps) {
    const currentReviewType = (project.review_type || 'interventional') as ReviewType;

    return (
        <SettingsPage>
            <SettingsGroup>
                <SettingsRow
                    label={t('project', 'basicProjectNameLabel')}
                    htmlFor="name"
                    required
                    hint={t('project', 'basicProjectNameHint')}
                >
                    {({describedBy}) => (
                        <Input
                            id="name"
                            variant="quiet"
                            value={project.name}
                            onChange={(e) => onChange({name: e.target.value})}
                            placeholder={t('project', 'basicProjectNamePlaceholder')}
                            required
                            aria-describedby={describedBy}
                            className="max-w-2xl"
                        />
                    )}
                </SettingsRow>
                <SettingsRow
                    label={t('project', 'basicDescriptionLabel')}
                    htmlFor="description"
                    hint={t('project', 'basicDescriptionHint')}
                    align="start"
                >
                    {({describedBy}) => (
                        <Textarea
                            id="description"
                            variant="quiet"
                            value={project.description ?? ''}
                            onChange={(e) => onChange({description: e.target.value})}
                            placeholder={t('project', 'basicDescriptionPlaceholder')}
                            rows={4}
                            aria-describedby={describedBy}
                            className="resize-none"
                        />
                    )}
                </SettingsRow>
                <SettingsRow
                    label={t('project', 'basicReviewTypeLabel')}
                    htmlFor="review_type"
                    required
                    hint={REVIEW_TYPES[currentReviewType].description}
                >
                    {({describedBy}) => (
                        <Select
                            value={currentReviewType}
                            onValueChange={(value: ReviewType) => onChange({review_type: value})}
                        >
                            <SelectTrigger
                                id="review_type"
                                variant="quiet"
                                aria-describedby={describedBy}
                                className="max-w-md"
                            >
                                <SelectValue/>
                            </SelectTrigger>
                            <SelectContent>
                                {(Object.keys(REVIEW_TYPES) as ReviewType[]).map((type) => (
                                    <SelectItem key={type} value={type}>
                                        <div className="flex items-center gap-2">
                                            <span>{REVIEW_TYPES[type].label}</span>
                                            {REVIEW_TYPES[type].badge && (
                                                <Badge variant="secondary" className="text-[11px]">
                                                    {REVIEW_TYPES[type].badge}
                                                </Badge>
                                            )}
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </SettingsRow>
            </SettingsGroup>
        </SettingsPage>
    );
}
