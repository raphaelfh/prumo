/**
 * IdentifiersSection — the article editor's "identifiers" step: DOI, PMID,
 * PMCID, arXiv id, PII.
 *
 * Zotero-style: each field is a label -> value row (ArticleFieldRow) that
 * renders as text and becomes an input only when clicked. No card chrome.
 */

import type {Dispatch, SetStateAction} from 'react';
import {ArticleFieldRow} from '../ArticleFieldRow';
import {SettingsSection} from '@/components/settings';
import {t} from '@/lib/copy';
import type {FormData} from '../ArticleForm';

interface IdentifiersSectionProps {
    formData: FormData;
    setFormData: Dispatch<SetStateAction<FormData>>;
}

export function IdentifiersSection({formData, setFormData}: IdentifiersSectionProps) {
    return (
        <section id="article-section-identifiers" className="scroll-mt-4 min-w-0 space-y-1">
            <SettingsSection title={t('articles', 'identifiersLabel')}>
                <ArticleFieldRow
                    label={t('articles', 'doi')}
                    value={formData.doi}
                    onCommit={(next) => setFormData({...formData, doi: next})}
                    placeholder="10.xxxx/xxxxx"
                />
                <ArticleFieldRow
                    label={t('articles', 'pmid')}
                    value={formData.pmid}
                    onCommit={(next) => setFormData({...formData, pmid: next})}
                    placeholder="PubMed ID"
                />
                <ArticleFieldRow
                    label={t('articles', 'pmcidLabel')}
                    value={formData.pmcid}
                    onCommit={(next) => setFormData({...formData, pmcid: next})}
                    placeholder="PMC ID"
                />
                <ArticleFieldRow
                    label={t('articles', 'arxivIdLabel')}
                    value={formData.arxiv_id}
                    onCommit={(next) => setFormData({...formData, arxiv_id: next})}
                    placeholder="arXiv:1234.5678"
                />
                <ArticleFieldRow
                    label={t('articles', 'piiLabel')}
                    value={formData.pii}
                    onCommit={(next) => setFormData({...formData, pii: next})}
                />
            </SettingsSection>
        </section>
    );
}
