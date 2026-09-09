/**
 * PublicationSection — the article editor's "publication" step: journal
 * details and publication date. Date fields render inline validation errors
 * that ArticleForm computes; this section only reports change/blur.
 */

import type {Dispatch, SetStateAction} from 'react';
import {AlertCircle} from 'lucide-react';
import {Input} from "@/components/ui/input";
import {cn} from "@/lib/utils";
import {SettingsCard, SettingsField, SettingsSection} from '@/components/settings';
import {t} from '@/lib/copy';
import type {FormData} from '../ArticleForm';

type DateField = 'publication_year' | 'publication_month' | 'publication_day';

interface PublicationSectionProps {
    formData: FormData;
    setFormData: Dispatch<SetStateAction<FormData>>;
    validationErrors: {
        publication_year?: string;
        publication_month?: string;
        publication_day?: string;
    };
    onDateFieldChange: (field: DateField, value: string) => void;
    onValidateDateField: (field: DateField, value: string) => void;
}

export function PublicationSection({
    formData,
    setFormData,
    validationErrors,
    onDateFieldChange,
    onValidateDateField,
}: PublicationSectionProps) {
    return (
        <section id="article-section-publication" className="scroll-mt-4 min-w-0 space-y-6">
            <SettingsSection title={t('articles', 'publication')}
                             description={t('articles', 'publicationDesc')}>
                <SettingsCard
                    title={t('articles', 'publicationDetails')}
                    description={t('articles', 'publicationDetailsDesc')}
                >
                    <SettingsField label={t('articles', 'journalTitle')} htmlFor="journal_title"
                                   hint={t('articles', 'journalPlaceholder')}>
                        <Input
                            id="journal_title"
                            value={formData.journal_title}
                            onChange={(e) => setFormData({
                                ...formData,
                                journal_title: e.target.value
                            })}
                            placeholder={t('articles', 'journalPlaceholder')}
                            className="h-9 w-full min-w-0 text-[13px]"
                        />
                    </SettingsField>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <SettingsField label={t('articles', 'publicationYear')}
                                       htmlFor="publication_year">
                            <Input
                                id="publication_year"
                                type="number"
                                value={formData.publication_year}
                                onChange={(e) => onDateFieldChange('publication_year', e.target.value)}
                                onBlur={(e) => onValidateDateField('publication_year', e.target.value)}
                                placeholder="2024"
                                min={1600}
                                max={2500}
                                className={cn('h-9 text-[13px]', validationErrors.publication_year && 'border-destructive')}
                            />
                            {validationErrors.publication_year && (
                                <p className="text-[12px] text-destructive flex items-center gap-1 pt-1">
                                    <AlertCircle className="h-3 w-3 shrink-0"/>
                                    {validationErrors.publication_year}
                                </p>
                            )}
                        </SettingsField>
                        <SettingsField label={t('articles', 'publicationMonth')}
                                       htmlFor="publication_month">
                            <Input
                                id="publication_month"
                                type="number"
                                value={formData.publication_month}
                                onChange={(e) => onDateFieldChange('publication_month', e.target.value)}
                                onBlur={(e) => onValidateDateField('publication_month', e.target.value)}
                                placeholder="1-12"
                                min={1}
                                max={12}
                                className={cn('h-9 text-[13px]', validationErrors.publication_month && 'border-destructive')}
                            />
                            {validationErrors.publication_month && (
                                <p className="text-[12px] text-destructive flex items-center gap-1 pt-1">
                                    <AlertCircle className="h-3 w-3 shrink-0"/>
                                    {validationErrors.publication_month}
                                </p>
                            )}
                        </SettingsField>
                    </div>
                    <SettingsField label={t('articles', 'publicationDay')}
                                   htmlFor="publication_day">
                        <Input
                            id="publication_day"
                            type="number"
                            value={formData.publication_day}
                            onChange={(e) => onDateFieldChange('publication_day', e.target.value)}
                            onBlur={(e) => onValidateDateField('publication_day', e.target.value)}
                            placeholder="1-31"
                            min={1}
                            max={31}
                            className={cn('h-9 max-w-xs text-[13px]', validationErrors.publication_day && 'border-destructive')}
                        />
                        {validationErrors.publication_day && (
                            <p className="text-[12px] text-destructive flex items-center gap-1 pt-1">
                                <AlertCircle className="h-3 w-3 shrink-0"/>
                                {validationErrors.publication_day}
                            </p>
                        )}
                    </SettingsField>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <SettingsField label={t('articles', 'volume')} htmlFor="volume">
                            <Input
                                id="volume"
                                value={formData.volume}
                                onChange={(e) => setFormData({...formData, volume: e.target.value})}
                                placeholder={t('articles', 'volumePlaceholder')}
                                className="h-9 text-[13px]"
                            />
                        </SettingsField>
                        <SettingsField label={t('articles', 'edition')} htmlFor="issue">
                            <Input
                                id="issue"
                                value={formData.issue}
                                onChange={(e) => setFormData({...formData, issue: e.target.value})}
                                placeholder="3"
                                className="h-9 text-[13px]"
                            />
                        </SettingsField>
                        <SettingsField label={t('articles', 'pages')} htmlFor="pages">
                            <Input
                                id="pages"
                                value={formData.pages}
                                onChange={(e) => setFormData({...formData, pages: e.target.value})}
                                placeholder={t('articles', 'pagesPlaceholder')}
                                className="h-9 text-[13px]"
                            />
                        </SettingsField>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <SettingsField label={t('articles', 'issnLabel')} htmlFor="journal_issn">
                            <Input
                                id="journal_issn"
                                value={formData.journal_issn}
                                onChange={(e) => setFormData({
                                    ...formData,
                                    journal_issn: e.target.value
                                })}
                                placeholder="1234-5678"
                                className="h-9 text-[13px]"
                            />
                        </SettingsField>
                        <SettingsField label={t('articles', 'formJournalEissn')}
                                       htmlFor="journal_eissn">
                            <Input
                                id="journal_eissn"
                                value={formData.journal_eissn}
                                onChange={(e) => setFormData({
                                    ...formData,
                                    journal_eissn: e.target.value
                                })}
                                placeholder="1234-5678"
                                className="h-9 text-[13px]"
                            />
                        </SettingsField>
                    </div>
                    <SettingsField label={t('articles', 'formJournalPublisher')}
                                   htmlFor="journal_publisher">
                        <Input
                            id="journal_publisher"
                            value={formData.journal_publisher}
                            onChange={(e) => setFormData({
                                ...formData,
                                journal_publisher: e.target.value
                            })}
                            className="h-9 w-full min-w-0 text-[13px]"
                        />
                    </SettingsField>
                </SettingsCard>
            </SettingsSection>
        </section>
    );
}
