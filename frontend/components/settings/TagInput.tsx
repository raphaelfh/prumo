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

export type TagInputVariant = 'badge' | 'list';

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
            <div className={cn('space-y-3', className)}>
                <div className="flex gap-2">
                    <Input
                        placeholder={placeholder}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className={cn('text-[13px]', inputClassName)}
                    />
                    <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
                        <Plus className="h-4 w-4" strokeWidth={1.5}/>
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
                                    size="icon"
                                    variant="ghost"
                                    className="h-5 w-5 rounded-full hover:bg-muted"
                                    onClick={() => onRemove(index)}
                                    aria-label={t('common', 'remove')}
                                >
                  <X className="h-3 w-3" strokeWidth={1.5}/>
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
        <div className={cn('space-y-3', className)}>
            <div className="flex gap-2">
                <Input
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className={cn('text-[13px]', inputClassName)}
                />
                <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
                    <Plus className="h-4 w-4" strokeWidth={1.5}/>
                </Button>
            </div>
            {items.length > 0 && (
                <ul className="space-y-2">
                    {items.map((item, index) => (
                        <li
                            key={`${item}-${index}`}
                            className={cn(
                                'flex items-center gap-2 p-2 rounded-md border text-[13px]',
                                listItemClasses[listVariant]
                            )}
                        >
                            <span className="flex-1 text-muted-foreground">{item}</span>
                            <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 flex-shrink-0"
                                onClick={() => onRemove(index)}
                                aria-label="Remover"
                            >
                                <X className="h-3 w-3" strokeWidth={1.5}/>
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
