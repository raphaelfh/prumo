/**
 * ArticleFormHeader — chrome pieces extracted out of ArticleForm.tsx to keep
 * that file under the file-size fitness cap (`scripts/fitness/check_file_size.py`):
 * the shared Cancel/Save action pair and the loading placeholder. ArticleForm
 * keeps its own compact action-only strip and renders ArticleFormActions
 * inside it.
 */

import {Loader2, Save} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {t} from '@/lib/copy';

export function ArticleFormLoadingState() {
    return (
        <div className="flex items-center justify-center h-full min-h-[240px]">
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

/** Cancel/Save action pair rendered in the panel's compact action strip. */
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
