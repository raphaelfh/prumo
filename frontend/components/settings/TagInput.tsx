/**
 * Input + add button + tag list with remove.
 * Substitui o pattern repetido em AdvancedSettingsSection e PICOTSItemEditor.
 */

import * as React from 'react';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Plus, X} from 'lucide-react';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

type TagInputVariant = 'badge' | 'list';

export interface TagInputProps {
    items: string[];
    onAdd: (value: string) => void;
    onRemove: (index: number) => void;
    placeholder?: string;
    variant?: TagInputVariant;
    /** List style: 'green' for inclusion, 'red' for exclusion, 'neutral' default */
    listVariant?: 'neutral' | 'green' | 'red';
    className?: string;
    inputClassName?: string;
}

export function TagInput({
                             items,
                             onAdd,
                             onRemove,
                             placeholder = t('common', 'addItemPlaceholder'),
                             variant = 'badge',
                             listVariant = 'neutral',
                             className,
                             inputClassName,
                         }: TagInputProps) {
    const [value, setValue] = React.useState('');

    const handleAdd = () => {
        const trimmed = value.trim();
        if (trimmed) {
            onAdd(trimmed);
            setValue('');
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAdd();
        }
    };

    if (variant === 'badge') {
        return (
            <div className={cn('space-y-2', className)}>
                <div className="flex gap-1.5">
                    {/* h-7 to match the Button beside it. The Input default is
                        h-10, so this pair rendered a 40px field next to a 28px
                        button on every settings page — pre-dating the compact
                        default, and fixed here rather than left as the one row
                        that ignores the tier. */}
                    <Input
                        placeholder={placeholder}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className={cn('h-7 text-[13px]', inputClassName)}
                    />
                    <Button type="button" variant="outline" onClick={handleAdd}>
                        <Plus strokeWidth={1.5}/>
                    </Button>
                </div>
                {items.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {items.map((item, index) => (
                            <span
                                key={`${item}-${index}`}
                                className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-md bg-muted/50 text-[13px] border border-border/40"
                            >
                {item}
                                <Button
                                    type="button"
                                    size="icon-xs"
                                    variant="ghost"
                                    className="rounded-full hover:bg-muted"
                                    onClick={() => onRemove(index)}
                                    aria-label={t('common', 'remove')}
                                >
                  <X strokeWidth={1.5}/>
                </Button>
              </span>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    const listItemClasses = {
        neutral: 'bg-muted/50 border-border/40',
        green: 'bg-green-500/5 border-green-500/20',
        red: 'bg-red-500/5 border-red-500/20',
    };

    return (
        <div className={cn('space-y-1.5', className)}>
            <div className={'flex gap-1.5'}>
                <Input
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className={cn('h-7 text-[13px]', inputClassName)}
                />
                <Button type="button" variant="outline" onClick={handleAdd}>
                    <Plus strokeWidth={1.5}/>
                </Button>
            </div>
            {items.length > 0 && (
                <ul className="space-y-1">
                    {items.map((item, index) => (
                        <li
                            key={`${item}-${index}`}
                            className={cn(
                                'flex items-center gap-2 rounded-md border py-0.5 pl-2 pr-0.5 text-[13px]',
                                listItemClasses[listVariant]
                            )}
                        >
                            <span className="flex-1 text-muted-foreground">{item}</span>
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                className="shrink-0"
                                onClick={() => onRemove(index)}
                                aria-label={t('common', 'remove')}
                            >
                                <X strokeWidth={1.5}/>
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
