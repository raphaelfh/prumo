/**
 * BasicInfoSection — the article editor's "basic" step: item type, title,
 * abstract, and authors. Presentational; ArticleForm owns `formData` and
 * `authorRows` and passes down exactly the setters this section needs.
 *
 * Zotero-style: each field is a label -> value row (ArticleFieldRow) that
 * renders as text and becomes an input only when clicked. No card chrome.
 */

import type {Dispatch, SetStateAction} from 'react';
import {ArticleFieldRow} from '../ArticleFieldRow';
import {ArticleAuthorsField} from '../ArticleAuthorsField';
import {SettingsSection} from '@/components/settings';
import {t} from '@/lib/copy';
import {
    ITEM_TYPE_CUSTOM_SELECT_VALUE,
    ITEM_TYPE_NONE_SELECT_VALUE,
    ZOTERO_ITEM_TYPES,
} from '@/lib/zoteroItemTypes';
import type {AuthorFormRow} from '@/lib/articleAuthors';
import type {FormData} from '../ArticleForm';

interface BasicInfoSectionProps {
    formData: FormData;
    setFormData: Dispatch<SetStateAction<FormData>>;
    saving: boolean;
    authorRows: AuthorFormRow[];
    onAuthorRowsChange: (rows: AuthorFormRow[]) => void;
    itemTypeSelectValue: string;
    onItemTypeSelectChange: (value: string) => void;
}

export function BasicInfoSection({
    formData,
    setFormData,
    saving,
    authorRows,
    onAuthorRowsChange,
    itemTypeSelectValue,
    onItemTypeSelectChange,
}: BasicInfoSectionProps) {
    const itemTypeOptions = [
        {value: ITEM_TYPE_NONE_SELECT_VALUE, label: t('articles', 'itemTypeNone')},
        ...ZOTERO_ITEM_TYPES.map((opt) => ({value: opt.value, label: opt.label})),
        {value: ITEM_TYPE_CUSTOM_SELECT_VALUE, label: t('articles', 'itemTypeCustom')},
    ];

    return (
        <section id="article-section-basic" className="scroll-mt-4 space-y-1">
            <SettingsSection title={t('articles', 'basicInfo')} density="compact">
                <ArticleFieldRow
                    label={t('articles', 'itemTypeLabel')}
                    value={itemTypeSelectValue}
                    onCommit={onItemTypeSelectChange}
                    control="select"
                    options={itemTypeOptions}
                    placeholder={t('articles', 'itemTypePlaceholder')}
                    disabled={saving}
                />
                {itemTypeSelectValue === ITEM_TYPE_CUSTOM_SELECT_VALUE && (
                    <ArticleFieldRow
                        label={t('articles', 'itemTypeCustom')}
                        value={formData.article_type}
                        onCommit={(next) => setFormData({...formData, article_type: next})}
                        placeholder={t('articles', 'itemTypeCustomPlaceholder')}
                        hint={t('articles', 'itemTypeCustomHint')}
                        disabled={saving}
                    />
                )}
                <ArticleFieldRow
                    label={t('articles', 'titleRequired')}
                    value={formData.title}
                    onCommit={(next) => setFormData({...formData, title: next})}
                    control="multiline"
                    placeholder={t('articles', 'titlePlaceholder')}
                />
                <ArticleFieldRow
                    label={t('articles', 'abstract')}
                    value={formData.abstract}
                    onCommit={(next) => setFormData({...formData, abstract: next})}
                    control="multiline"
                    placeholder={t('articles', 'abstractPlaceholder')}
                />
                <ArticleAuthorsField rows={authorRows} onChange={onAuthorRowsChange} disabled={saving}/>
            </SettingsSection>
        </section>
    );
}
