import {useCallback, useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';
import {MinusCircle, Plus, Tag} from 'lucide-react';

interface ArticleKeywordsFieldProps {
    value: string[];
    onChange: (keywords: string[]) => void;
    disabled?: boolean;
    /** id do input de nova keyword (acessibilidade com SettingsField) */
    draftInputId?: string;
    className?: string;
}

function headerLabel(count: number): string {
    if (count === 1) return t('articles', 'keywordsHeaderOne');
    return t('articles', 'keywordsHeaderPlural').replace('{{n}}', String(count));
}

export function ArticleKeywordsField({
                                         value,
                                         onChange,
                                         disabled,
                                         draftInputId = 'article_keywords_draft',
                                         className,
                                     }: ArticleKeywordsFieldProps) {
    const [draft, setDraft] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const commitDraft = useCallback(() => {
        const trimmed = draft.trim();
        if (!trimmed) {
            setDraft('');
            return;
        }
        const lower = trimmed.toLowerCase();
        if (value.some((k) => k.trim().toLowerCase() === lower)) {
            setDraft('');
            return;
        }
        onChange([...value, trimmed]);
        setDraft('');
    }, [draft, onChange, value]);

    const removeAt = (index: number) => {
        onChange(value.filter((_, i) => i !== index));
    };

    const focusDraft = () => {
        inputRef.current?.focus();
    };

    return (
        <div className={cn('overflow-hidden rounded-md border border-border/40', className)}>
            <div className="flex items-center justify-between gap-2 border-b border-border/40 bg-muted/20 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <Tag className="h-4 w-4 shrink-0 text-orange-500 dark:text-orange-400" strokeWidth={1.5}
                         aria-hidden/>
                    <span
                        className="truncate text-[13px] font-medium text-foreground">{headerLabel(value.length)}</span>
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={focusDraft}
                    disabled={disabled}
                    aria-label={t('articles', 'keywordsAddFocusAria')}
                >
                    <Plus className="h-4 w-4" strokeWidth={1.5}/>
                </Button>
            </div>
            <ul className="divide-y divide-border/40" role="list">
                {value.map((kw, index) => (
                    <li key={`${index}-${kw}`} className="flex items-center gap-2 px-3 py-2" role="listitem">
                        <Tag className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.5} aria-hidden/>
                        <span className="min-w-0 flex-1 text-[13px] text-foreground">{kw}</span>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => removeAt(index)}
                            disabled={disabled}
                            aria-label={t('articles', 'keywordsRemoveAria')}
                        >
                            <MinusCircle className="h-4 w-4" strokeWidth={1.5}/>
                        </Button>
                    </li>
                ))}
                <li className="flex items-center gap-2 px-3 py-2" role="listitem">
                    <Tag className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.5} aria-hidden/>
                    <Input
                        ref={inputRef}
                        id={draftInputId}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                commitDraft();
                            }
                        }}
                        onBlur={() => commitDraft()}
                        placeholder={t('articles', 'keywordsAddPlaceholder')}
                        disabled={disabled}
                        className="h-9 flex-1 min-w-0 border-primary/35 text-[13px] focus-visible:border-primary/60"
                        aria-label={t('articles', 'keywordsDraftInputAria')}
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                            setDraft('');
                            inputRef.current?.focus();
                        }}
                        disabled={disabled}
                        aria-label={t('articles', 'keywordsClearDraftAria')}
                    >
                        <MinusCircle className="h-4 w-4" strokeWidth={1.5}/>
                    </Button>
                </li>
            </ul>
        </div>
    );
}
