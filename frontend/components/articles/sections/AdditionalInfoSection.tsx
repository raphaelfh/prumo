/**
 * AdditionalInfoSection — the article editor's "additional" step: keywords,
 * MeSH terms, URLs, language, publication status, open access, license,
 * study design, conflicts of interest, and data availability.
 *
 * Zotero-style: each field is a label -> value row (ArticleFieldRow) that
 * renders as text and becomes an input only when clicked. No card chrome.
 * ArticleKeywordsField is a self-contained list widget (its own header,
 * add/remove affordances) — it renders directly, not through ArticleFieldRow,
 * same as ArticleAuthorsField in BasicInfoSection.
 */

import type {Dispatch, SetStateAction} from 'react';
import {ArticleFieldRow} from '../ArticleFieldRow';
import {ArticleKeywordsField} from '../ArticleKeywordsField';
import {SettingsSection} from '@/components/settings';
import {t} from '@/lib/copy';
import type {FormData} from '../ArticleForm';

interface AdditionalInfoSectionProps {
    formData: FormData;
    setFormData: Dispatch<SetStateAction<FormData>>;
    saving: boolean;
}

export function AdditionalInfoSection({formData, setFormData, saving}: AdditionalInfoSectionProps) {
    return (
        <section id="article-section-additional" className="scroll-mt-4 space-y-1">
            <SettingsSection title={t('articles', 'additionalInfo')}>
                <ArticleKeywordsField
                    value={formData.keywords}
                    onChange={(keywords) => setFormData((prev) => ({...prev, keywords}))}
                    disabled={saving}
                    draftInputId="article_keywords_draft"
                />
                <p className="text-[12px] text-muted-foreground/70">
                    {t('articles', 'keywordsFieldHint')}
                </p>
                <ArticleFieldRow
                    label={t('articles', 'meshTermsLabel')}
                    value={formData.mesh_terms}
                    onCommit={(next) => setFormData({...formData, mesh_terms: next})}
                    placeholder={t('articles', 'meshPlaceholder')}
                    disabled={saving}
                />
                <ArticleFieldRow
                    label={t('articles', 'articleUrl')}
                    value={formData.url_landing}
                    onCommit={(next) => setFormData({...formData, url_landing: next})}
                    placeholder="https://…"
                    disabled={saving}
                />
                <ArticleFieldRow
                    label={t('articles', 'formPdfUrl')}
                    value={formData.url_pdf}
                    onCommit={(next) => setFormData({...formData, url_pdf: next})}
                    placeholder="https://…"
                    disabled={saving}
                />
                <ArticleFieldRow
                    label={t('articles', 'languageLabel')}
                    value={formData.language}
                    onCommit={(next) => setFormData({...formData, language: next})}
                    placeholder={t('articles', 'languagePlaceholder')}
                    disabled={saving}
                />
                <ArticleFieldRow
                    label={t('articles', 'formPublicationStatus')}
                    value={formData.publication_status}
                    onCommit={(next) => setFormData({...formData, publication_status: next})}
                    disabled={saving}
                />
                <ArticleFieldRow
                    label={t('articles', 'formOpenAccess')}
                    value={String(formData.open_access)}
                    onCommit={(next) => setFormData({...formData, open_access: next === 'true'})}
                    control="switch"
                    switchLabels={{on: t('articles', 'openAccessOn'), off: t('articles', 'openAccessOff')}}
                    disabled={saving}
                />
                <ArticleFieldRow
                    label={t('articles', 'licenseLabel')}
                    value={formData.license}
                    onCommit={(next) => setFormData({...formData, license: next})}
                    disabled={saving}
                />
                <ArticleFieldRow
                    label={t('articles', 'studyDesignLabel')}
                    value={formData.study_design}
                    onCommit={(next) => setFormData({...formData, study_design: next})}
                    disabled={saving}
                />
                <ArticleFieldRow
                    label={t('articles', 'conflictsOfInterestLabel')}
                    value={formData.conflicts_of_interest}
                    onCommit={(next) => setFormData({...formData, conflicts_of_interest: next})}
                    control="multiline"
                    disabled={saving}
                />
                <ArticleFieldRow
                    label={t('articles', 'dataAvailabilityLabel')}
                    value={formData.data_availability}
                    onCommit={(next) => setFormData({...formData, data_availability: next})}
                    control="multiline"
                    disabled={saving}
                />
            </SettingsSection>
        </section>
    );
}
