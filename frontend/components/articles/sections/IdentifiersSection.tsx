/**
 * IdentifiersSection — the article editor's "identifiers" step: DOI, PMID,
 * PMCID, arXiv id, PII.
 */

import type {Dispatch, SetStateAction} from 'react';
import {Input} from "@/components/ui/input";
import {SettingsCard, SettingsField, SettingsSection} from '@/components/settings';
import {t} from '@/lib/copy';
import type {FormData} from '../ArticleForm';

interface IdentifiersSectionProps {
    formData: FormData;
    setFormData: Dispatch<SetStateAction<FormData>>;
}

export function IdentifiersSection({formData, setFormData}: IdentifiersSectionProps) {
    return (
        <section id="article-section-identifiers" className="scroll-mt-4 min-w-0 space-y-6">
            <SettingsSection title={t('articles', 'identifiersLabel')}
                             description={t('articles', 'identifiersDesc')}>
                <SettingsCard title={t('articles', 'identifiersLabel')}>
                    <SettingsField label={t('articles', 'doi')} htmlFor="doi">
                        <Input
                            id="doi"
                            value={formData.doi}
                            onChange={(e) => setFormData({...formData, doi: e.target.value})}
                            placeholder="10.xxxx/xxxxx"
                            className="h-9 w-full min-w-0 text-[13px]"
                        />
                    </SettingsField>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <SettingsField label={t('articles', 'pmid')} htmlFor="pmid">
                            <Input
                                id="pmid"
                                value={formData.pmid}
                                onChange={(e) => setFormData({...formData, pmid: e.target.value})}
                                placeholder="PubMed ID"
                                className="h-9 text-[13px]"
                            />
                        </SettingsField>
                        <SettingsField label={t('articles', 'pmcidLabel')} htmlFor="pmcid">
                            <Input
                                id="pmcid"
                                value={formData.pmcid}
                                onChange={(e) => setFormData({...formData, pmcid: e.target.value})}
                                placeholder="PMC ID"
                                className="h-9 text-[13px]"
                            />
                        </SettingsField>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <SettingsField label={t('articles', 'arxivIdLabel')} htmlFor="arxiv_id">
                            <Input
                                id="arxiv_id"
                                value={formData.arxiv_id}
                                onChange={(e) => setFormData({
                                    ...formData,
                                    arxiv_id: e.target.value
                                })}
                                placeholder="arXiv:1234.5678"
                                className="h-9 text-[13px]"
                            />
                        </SettingsField>
                        <SettingsField label={t('articles', 'piiLabel')} htmlFor="pii">
                            <Input id="pii" value={formData.pii}
                                   onChange={(e) => setFormData({...formData, pii: e.target.value})}
                                   className="h-9 text-[13px]"/>
                        </SettingsField>
                    </div>
                </SettingsCard>
            </SettingsSection>
        </section>
    );
}
