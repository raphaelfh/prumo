import * as React from 'react';
import {Button} from '@/components/ui/button';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {ChevronDown, ChevronsUpDown, ChevronUp, LayoutGrid, SlidersHorizontal} from 'lucide-react';

export interface SortOption {
    value: string;
    label: string;
}

export interface DisplayColumnOption {
    key: string;
    label: string;
    disabled?: boolean;
}

export interface ListDisplaySortPopoverProps {
    /** Sort section */
    sortOptions: SortOption[];
    sortField: string;
    sortDirection: 'asc' | 'desc';
    onSortFieldChange: (value: string) => void;
    onSortDirectionChange: () => void;
    orderLabel?: string;
    /** Display section (optional). If omitted or empty, only sort is shown. */
    columns?: DisplayColumnOption[];
    visibleKeys?: Record<string, boolean>;
    onToggleColumn?: (key: string) => void;
    displayPropertiesLabel?: string;
    /** Trigger / i18n */
    tooltipLabel?: string;
    ariaLabel?: string;
}

export function ListDisplaySortPopover({
                                           sortOptions,
                                           sortField,
                                           sortDirection,
                                           onSortFieldChange,
                                           onSortDirectionChange,
                                           orderLabel = 'Ordering',
                                           columns,
                                           visibleKeys = {},
                                           onToggleColumn,
                                           displayPropertiesLabel = 'Display properties',
                                           tooltipLabel = 'Display & sort',
                                           ariaLabel = 'Display options',
                                       }: ListDisplaySortPopoverProps) {
    const [open, setOpen] = React.useState(false);
    const showDisplaySection = Array.isArray(columns) && columns.length > 0 && onToggleColumn;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground"
                                aria-label={ariaLabel}
                            >
                                <SlidersHorizontal className="h-4 w-4"/>
                            </Button>
                        </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{tooltipLabel}</TooltipContent>
                </Tooltip>
            </TooltipProvider>
            <PopoverContent className="w-72 p-0 border-border/50 shadow-[0_8px_30px_rgb(0,0,0,0.04)]" align="end">
                <div className="p-3 space-y-4">
                    <div className="space-y-2">
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <ChevronsUpDown className="h-3.5 w-3.5"/>
                            {orderLabel}
                        </p>
                        <div className="flex gap-2 items-center">
                            <Select value={sortField} onValueChange={onSortFieldChange}>
                                <SelectTrigger className="h-8 text-[13px] flex-1">
                                    <SelectValue/>
                                </SelectTrigger>
                                <SelectContent>
                                    {sortOptions.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 w-8 p-0 shrink-0"
                                onClick={onSortDirectionChange}
                            >
                                {sortDirection === 'asc' ? (
                                    <ChevronUp className="h-3.5 w-3.5"/>
                                ) : (
                                    <ChevronDown className="h-3.5 w-3.5"/>
                                )}
                            </Button>
                        </div>
                    </div>
                    {showDisplaySection && (
                        <div className="space-y-2">
                            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                                <LayoutGrid className="h-3.5 w-3.5"/>
                                {displayPropertiesLabel}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {columns!.map(({key, label, disabled}) => (
                                    <button
                                        key={key}
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => !disabled && onToggleColumn?.(key)}
                                        className={`rounded-md border px-2 py-1 text-[12px] transition-colors disabled:opacity-60 disabled:cursor-default ${
                                            visibleKeys[key]
                                                ? 'border-primary/50 bg-primary/10 text-foreground'
                                                : 'border-border/40 bg-muted/30 text-muted-foreground hover:bg-muted/50'
                                        }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
