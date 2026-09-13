import {Button} from '@/components/ui/button';
import {IconButton} from '@/components/patterns/IconButton';
import {X} from 'lucide-react';
import type {ActiveFilterChip} from './activeFilters';

export interface ActiveFilterChipsProps {
    filters: ActiveFilterChip[];
    onClearField: (column: string) => void;
    onClearAll: () => void;
    clearAllLabel?: string;
    removeFilterAriaLabel: (label: string) => string;
}

export function ActiveFilterChips({
                                      filters,
                                      onClearField,
                                      onClearAll,
                                      clearAllLabel = 'Clear all',
                                      removeFilterAriaLabel,
                                  }: ActiveFilterChipsProps) {
    if (filters.length === 0) return null;

    return (
        <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
                {filters.map(({column, label, value}) => (
                    <span
                        key={`${column}-${value}`}
                        className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/40 px-2 py-1 text-[11px] text-foreground"
                    >
                        <span className="truncate max-w-[120px]">
                            {label}: {value}
                        </span>
                        <IconButton
                            label={removeFilterAriaLabel(label)}
                            size="icon-xs"
                            onClick={() => onClearField(column)}
                            icon={<X />}
                        />
                    </span>
                ))}
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-[11px] text-muted-foreground hover:text-foreground h-6 px-1.5"
                    onClick={onClearAll}
                >
                    {clearAllLabel}
                </Button>
            </div>
        </div>
    );
}
