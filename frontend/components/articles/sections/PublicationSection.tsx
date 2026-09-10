/**
 * PublicationSection — the article editor's "publication" step: journal
 * details and publication date. Date fields render inline validation errors
 * that ArticleForm computes; this section only reports change/blur.
 *
 * Zotero-style: each field is a label -> value row (ArticleFieldRow) that
 * renders as text and becomes an input only when clicked. No card chrome.
 */

import type {Dispatch, SetStateAction} from 'react';
import {ArticleFieldRow} from '../ArticleFieldRow';
import {SettingsSection} from '@/components/settings';
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
    const commitDateField = (field: DateField) => (next: string) => {
        onDateFieldChange(field, next);
        onValidateDateField(field, next);
    };

    return (
        <section id="article-section-publication" className="scroll-mt-4 min-w-0 space-y-1">
            <SettingsSection title={t('articles', 'publication')} density="compact">
                <ArticleFieldRow
                    label={t('articles', 'journalTitle')}
                    value={formData.journal_title}
                    onCommit={(next) => setFormData({...formData, journal_title: next})}
                    placeholder={t('articles', 'journalPlaceholder')}
                />
                <ArticleFieldRow
                    label={t('articles', 'publicationYear')}
                    value={formData.publication_year}
                    onCommit={commitDateField('publication_year')}
                    inputType="number"
                    min={1600}
                    max={2500}
                    placeholder="2024"
                    error={validationErrors.publication_year}
                />
                <ArticleFieldRow
                    label={t('articles', 'publicationMonth')}
                    value={formData.publication_month}
                    onCommit={commitDateField('publication_month')}
                    inputType="number"
                    min={1}
                    max={12}
                    placeholder="1-12"
                    error={validationErrors.publication_month}
                />
                <ArticleFieldRow
                    label={t('articles', 'publicationDay')}
                    value={formData.publication_day}
                    onCommit={commitDateField('publication_day')}
                    inputType="number"
                    min={1}
                    max={31}
                    placeholder="1-31"
                    error={validationErrors.publication_day}
                />
                <ArticleFieldRow
                    label={t('articles', 'volume')}
                    value={formData.volume}
                    onCommit={(next) => setFormData({...formData, volume: next})}
                    placeholder={t('articles', 'volumePlaceholder')}
                />
                <ArticleFieldRow
                    label={t('articles', 'edition')}
                    value={formData.issue}
                    onCommit={(next) => setFormData({...formData, issue: next})}
                    placeholder="3"
                />
                <ArticleFieldRow
                    label={t('articles', 'pages')}
                    value={formData.pages}
                    onCommit={(next) => setFormData({...formData, pages: next})}
                    placeholder={t('articles', 'pagesPlaceholder')}
                />
                <ArticleFieldRow
                    label={t('articles', 'issnLabel')}
                    value={formData.journal_issn}
                    onCommit={(next) => setFormData({...formData, journal_issn: next})}
                    placeholder="1234-5678"
                />
                <ArticleFieldRow
                    label={t('articles', 'formJournalEissn')}
                    value={formData.journal_eissn}
                    onCommit={(next) => setFormData({...formData, journal_eissn: next})}
                    placeholder="1234-5678"
                />
                <ArticleFieldRow
                    label={t('articles', 'formJournalPublisher')}
                    value={formData.journal_publisher}
                    onCommit={(next) => setFormData({...formData, journal_publisher: next})}
                />
            </SettingsSection>
        </section>
    );
}
