/**
 * BasicInfoSection — the article editor's "basic" step: item type, title,
 * abstract, and authors. Presentational; ArticleForm owns `formData` and
 * `authorRows` and passes down exactly the setters this section needs.
 */

import type {Dispatch, SetStateAction} from 'react';
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {ArticleAuthorsField} from '../ArticleAuthorsField';
import {SettingsCard, SettingsField, SettingsSection} from '@/components/settings';
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
    return (
        <section id="article-section-basic" className="scroll-mt-4 space-y-6">
            <SettingsSection title={t('articles', 'basicInfo')}
                             description={t('articles', 'basicInfoDesc')}>
                <SettingsCard
                    title={t('articles', 'articleContentCardTitle')}
                    description={t('articles', 'titleAbstractAuthors')}
                >
                    <SettingsField label={t('articles', 'itemTypeLabel')} htmlFor="article_item_type">
                        <Select value={itemTypeSelectValue} onValueChange={onItemTypeSelectChange}
                                disabled={saving}>
                            <SelectTrigger id="article_item_type"
                                           className="h-9 w-full min-w-0 text-[13px]">
                                <SelectValue placeholder={t('articles', 'itemTypePlaceholder')}/>
                            </SelectTrigger>
                            <SelectContent className="max-h-[min(70vh,360px)]">
                                <SelectItem value={ITEM_TYPE_NONE_SELECT_VALUE} className="text-[13px]">
                                    {t('articles', 'itemTypeNone')}
                                </SelectItem>
                                {ZOTERO_ITEM_TYPES.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}
                                                className="text-[13px]">
                                        {opt.label}
                                    </SelectItem>
                                ))}
                                <SelectItem value={ITEM_TYPE_CUSTOM_SELECT_VALUE}
                                            className="text-[13px]">
                                    {t('articles', 'itemTypeCustom')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        {itemTypeSelectValue === ITEM_TYPE_CUSTOM_SELECT_VALUE && (
                            <div className="space-y-2 pt-1">
                                <p className="text-[12px] text-muted-foreground/70">{t('articles', 'itemTypeCustomHint')}</p>
                                <Input
                                    id="article_type_custom"
                                    value={formData.article_type}
                                    onChange={(e) => setFormData({
                                        ...formData,
                                        article_type: e.target.value
                                    })}
                                    className="h-9 w-full min-w-0 text-[13px]"
                                    placeholder={t('articles', 'itemTypeCustomPlaceholder')}
                                    disabled={saving}
                                />
                            </div>
                        )}
                    </SettingsField>
                    <SettingsField label={t('articles', 'titleRequired')} htmlFor="title" required>
                        <Textarea
                            id="title"
                            value={formData.title}
                            onChange={(e) => setFormData({...formData, title: e.target.value})}
                            placeholder={t('articles', 'titlePlaceholder')}
                            className="min-h-[88px] resize-y text-[13px] leading-snug w-full min-w-0"
                            required
                        />
                    </SettingsField>
                    <SettingsField label={t('articles', 'abstract')} htmlFor="abstract"
                                   hint={t('articles', 'abstractPlaceholder')}>
                        <Textarea
                            id="abstract"
                            value={formData.abstract}
                            onChange={(e) => setFormData({...formData, abstract: e.target.value})}
                            placeholder={t('articles', 'abstractPlaceholder')}
                            rows={5}
                            className="w-full min-w-0 text-[13px] leading-snug"
                        />
                    </SettingsField>
                </SettingsCard>
                <SettingsCard title={t('articles', 'authors')}
                              description={t('articles', 'authorsPlaceholderComma')}>
                    <ArticleAuthorsField rows={authorRows} onChange={onAuthorRowsChange} disabled={saving}/>
                </SettingsCard>
            </SettingsSection>
        </section>
    );
}
