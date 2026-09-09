/**
 * AdditionalInfoSection — the article editor's "additional" step: keywords,
 * MeSH terms, URLs, language, publication status, open access, license,
 * study design, conflicts of interest, and data availability.
 */

import type {Dispatch, SetStateAction} from 'react';
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {Switch} from "@/components/ui/switch";
import {ArticleKeywordsField} from '../ArticleKeywordsField';
import {SettingsCard, SettingsField, SettingsSection} from '@/components/settings';
import {t} from '@/lib/copy';
import type {FormData} from '../ArticleForm';

interface AdditionalInfoSectionProps {
    formData: FormData;
    setFormData: Dispatch<SetStateAction<FormData>>;
    saving: boolean;
}

export function AdditionalInfoSection({formData, setFormData, saving}: AdditionalInfoSectionProps) {
    return (
        <section id="article-section-additional" className="scroll-mt-4 space-y-6">
            <SettingsSection title={t('articles', 'additionalInfo')}
                             description={t('articles', 'additionalInfoDesc')}>
                <SettingsCard title={t('articles', 'keywordsAndMetadata')}>
                    <SettingsField
                        label={t('articles', 'keywordsLabel')}
                        htmlFor="article_keywords_draft"
                        hint={t('articles', 'keywordsFieldHint')}
                    >
                        <ArticleKeywordsField
                            value={formData.keywords}
                            onChange={(keywords) => setFormData((prev) => ({...prev, keywords}))}
                            disabled={saving}
                            draftInputId="article_keywords_draft"
                        />
                    </SettingsField>
                    <SettingsField label={t('articles', 'meshTermsLabel')} htmlFor="mesh_terms"
                                   hint={t('articles', 'meshPlaceholder')}>
                        <Input
                            id="mesh_terms"
                            value={formData.mesh_terms}
                            onChange={(e) => setFormData({...formData, mesh_terms: e.target.value})}
                            placeholder={t('articles', 'meshPlaceholder')}
                            className="h-9 w-full min-w-0 text-[13px]"
                        />
                    </SettingsField>
                    <SettingsField label={t('articles', 'articleUrl')} htmlFor="url_landing">
                        <Input
                            id="url_landing"
                            type="url"
                            value={formData.url_landing}
                            onChange={(e) => setFormData({...formData, url_landing: e.target.value})}
                            placeholder="https://…"
                            className="h-9 w-full min-w-0 text-[13px]"
                        />
                    </SettingsField>
                    <SettingsField label={t('articles', 'formPdfUrl')} htmlFor="url_pdf">
                        <Input
                            id="url_pdf"
                            type="url"
                            value={formData.url_pdf}
                            onChange={(e) => setFormData({...formData, url_pdf: e.target.value})}
                            placeholder="https://…"
                            className="h-9 w-full min-w-0 text-[13px]"
                        />
                    </SettingsField>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <SettingsField label={t('articles', 'languageLabel')} htmlFor="language"
                                       hint={t('articles', 'languagePlaceholder')}>
                            <Input
                                id="language"
                                value={formData.language}
                                onChange={(e) => setFormData({...formData, language: e.target.value})}
                                placeholder={t('articles', 'languagePlaceholder')}
                                className="h-9 text-[13px]"
                            />
                        </SettingsField>
                        <SettingsField label={t('articles', 'formPublicationStatus')}
                                       htmlFor="publication_status">
                            <Input
                                id="publication_status"
                                value={formData.publication_status}
                                onChange={(e) => setFormData({
                                    ...formData,
                                    publication_status: e.target.value
                                })}
                                className="h-9 text-[13px]"
                            />
                        </SettingsField>
                    </div>
                    <div
                        className="flex items-center justify-between gap-4 rounded-md border border-border/40 px-3 py-2">
                        <Label htmlFor="open_access" className="cursor-pointer text-[13px] font-normal">
                            {t('articles', 'formOpenAccess')}
                        </Label>
                        <Switch id="open_access" checked={formData.open_access}
                                onCheckedChange={(c) => setFormData({...formData, open_access: c})}/>
                    </div>
                    <SettingsField label={t('articles', 'licenseLabel')} htmlFor="license">
                        <Input
                            id="license"
                            value={formData.license}
                            onChange={(e) => setFormData({...formData, license: e.target.value})}
                            className="h-9 w-full min-w-0 text-[13px]"
                        />
                    </SettingsField>
                    <SettingsField label={t('articles', 'studyDesignLabel')} htmlFor="study_design">
                        <Input
                            id="study_design"
                            value={formData.study_design}
                            onChange={(e) => setFormData({...formData, study_design: e.target.value})}
                            className="h-9 w-full min-w-0 text-[13px]"
                        />
                    </SettingsField>
                    <SettingsField label={t('articles', 'conflictsOfInterestLabel')}
                                   htmlFor="conflicts_of_interest">
                        <Textarea
                            id="conflicts_of_interest"
                            value={formData.conflicts_of_interest}
                            onChange={(e) => setFormData({
                                ...formData,
                                conflicts_of_interest: e.target.value
                            })}
                            rows={2}
                            className="w-full min-w-0 text-[13px] leading-snug"
                        />
                    </SettingsField>
                    <SettingsField label={t('articles', 'dataAvailabilityLabel')}
                                   htmlFor="data_availability">
                        <Textarea
                            id="data_availability"
                            value={formData.data_availability}
                            onChange={(e) => setFormData({
                                ...formData,
                                data_availability: e.target.value
                            })}
                            rows={2}
                            className="w-full min-w-0 text-[13px] leading-snug"
                        />
                    </SettingsField>
                </SettingsCard>
            </SettingsSection>
        </section>
    );
}
