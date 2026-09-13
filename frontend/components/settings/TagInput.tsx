/**
 * Draft input + add control + the added items, each removable. Shared by
 * AdvancedSettingsSection and PICOTSItemEditor. Flat-grid look (spec
 * 2026-09-13-borderless-density-pass §4.1): quiet input, IconButton add,
 * borderless chips and list items tinted with theme tokens.
 */

import * as React from 'react';
import {Plus, X} from 'lucide-react';

import {IconButton} from '@/components/patterns/IconButton';
import {Input} from '@/components/ui/input';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

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
    /** The draft input's id, so a SettingsRow label can point at it. */
    id?: string;
    /** The draft input's description ids (SettingsRow's render-prop `describedBy`). */
    'aria-describedby'?: string;
    /** Names the add control, e.g. "Add to Inclusion criteria" (common.addToLabel). */
    addLabel: string;
}

const LIST_ITEM_TINT = {
    neutral: 'bg-muted/50',
    green: 'bg-success/10',
    red: 'bg-destructive/10',
} as const;

export function TagInput({
    items,
    onAdd,
    onRemove,
    placeholder = t('common', 'addItemPlaceholder'),
    variant = 'badge',
    listVariant = 'neutral',
    className,
    id,
    'aria-describedby': ariaDescribedBy,
    addLabel,
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

    const draft = (
        <div className="flex items-center gap-1">
            <Input
                id={id}
                aria-describedby={ariaDescribedBy}
                variant="quiet"
                placeholder={placeholder}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
            />
            <IconButton label={addLabel} icon={<Plus strokeWidth={1.5}/>} onClick={handleAdd}/>
        </div>
    );

    if (variant === 'badge') {
        return (
            <div className={cn('space-y-2', className)}>
                {draft}
                {items.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {items.map((item, index) => (
                            <span
                                key={`${item}-${index}`}
                                className="inline-flex items-center gap-1.5 rounded-md bg-muted/50 py-1 pl-2.5 pr-1.5 text-[13px]"
                            >
                                {item}
                                <IconButton
                                    label={t('common', 'remove')}
                                    size="icon-xs"
                                    className="rounded-full"
                                    onClick={() => onRemove(index)}
                                    icon={<X strokeWidth={1.5}/>}
                                />
                            </span>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className={cn('space-y-1.5', className)}>
            {draft}
            {items.length > 0 && (
                <ul className="space-y-1">
                    {items.map((item, index) => (
                        <li
                            key={`${item}-${index}`}
                            className={cn('flex items-center gap-2 rounded-md py-0.5 pl-2 pr-0.5 text-[13px]', LIST_ITEM_TINT[listVariant])}
                        >
                            <span className="flex-1 text-muted-foreground">{item}</span>
                            <IconButton
                                label={t('common', 'remove')}
                                size="icon-xs"
                                onClick={() => onRemove(index)}
                                icon={<X strokeWidth={1.5}/>}
                            />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
