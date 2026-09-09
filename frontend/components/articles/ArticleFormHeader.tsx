/**
 * ArticleFormHeader — chrome pieces extracted out of ArticleForm.tsx to keep
 * that file under the file-size fitness cap (`scripts/fitness/check_file_size.py`):
 * the `variant="page"` header, the shared Cancel/Save action pair, and the
 * loading placeholder. Panel variant does not use ArticleFormHeader itself —
 * it keeps its own compact action-only strip in ArticleForm — but reuses
 * ArticleFormActions and ArticleFormLoadingState.
 */

import type {ReactNode} from 'react';
import {ArrowLeft, Loader2, Save} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {PageHeader} from '@/components/patterns/PageHeader';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

interface ArticleFormLoadingStateProps {
    isPanel: boolean;
}

export function ArticleFormLoadingState({isPanel}: ArticleFormLoadingStateProps) {
    return (
        <div
            className={cn(
                'flex items-center justify-center',
                isPanel ? 'h-full min-h-[240px]' : 'h-screen'
            )}
        >
            <div className="text-center">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3 text-muted-foreground"/>
                <p className="text-[13px] text-muted-foreground">{t('articles', 'loadingArticle')}</p>
            </div>
        </div>
    );
}

interface ArticleFormActionsProps {
    mode: 'add' | 'edit';
    saving: boolean;
    disabled: boolean;
    onCancel: () => void;
    onSave: () => void;
}

/** Cancel/Save action pair shared by the page-header actions slot and the
 *  panel variant's compact action strip. */
export function ArticleFormActions({mode, saving, disabled, onCancel, onSave}: ArticleFormActionsProps) {
    return (
        <div className="flex items-center gap-2" data-testid="article-form-actions">
            <Button variant="outline" size="sm" className="h-8 px-3 text-[12px]" onClick={onCancel}>
                {t('common', 'cancel')}
            </Button>
            <Button
                size="sm"
                className="h-8 px-3 text-[12px] font-medium"
                onClick={onSave}
                disabled={disabled}
            >
                {saving ? (
                    <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin"/>
                        {t('articles', 'saving')}
                    </>
                ) : (
                    <>
                        <Save className="mr-1.5 h-3.5 w-3.5"/>
                        {mode === 'add' ? t('articles', 'createArticle') : t('common', 'save')}
                    </>
                )}
            </Button>
        </div>
    );
}

interface ArticleFormHeaderProps {
    mode: 'add' | 'edit';
    /** Edit mode's description IS the article's title; undefined in add mode. */
    articleTitle?: string;
    onDismiss: () => void;
    actions: ReactNode;
}

export function ArticleFormHeader({mode, articleTitle, onDismiss, actions}: ArticleFormHeaderProps) {
    return (
        <PageHeader
            leading={
                <Button variant="ghost" size="sm" onClick={onDismiss} aria-label={t('common', 'back')}>
                    {/*
                      * At 375px this bar is 374px wide and the actions group takes 206
                      * of it, so the identity group was compressed until the title
                      * rendered as nothing. The label folds first — the arrow plus the
                      * aria-label still name the button — and sr-only rather than
                      * `hidden` keeps that name in the accessibility tree.
                      */}
                    <ArrowLeft className="h-4 w-4 sm:mr-2"/>
                    <span data-slot="back-label" className="sr-only sm:not-sr-only">
                        {t('common', 'back')}
                    </span>
                </Button>
            }
            title={mode === 'add' ? t('articles', 'addArticle') : t('articles', 'editArticle')}
            description={
                /*
                 * Edit mode's description IS the article's title, and it is the only
                 * thing naming which article this is — so it must never fold. Add
                 * mode's merely restates the title next to it, so it is the one that
                 * gives way rather than the title.
                 */
                mode === 'edit' ? articleTitle : undefined
            }
            actions={actions}
        />
    );
}
