import * as React from 'react';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import {Check, ChevronDown} from 'lucide-react';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

export interface FacetOption {
    value: string;
    count: number;
}

interface FilterFacetMultiSelectFieldProps {
    id: string;
    label: string;
    value: string[];
    facets: FacetOption[];
    onChange: (value: string[]) => void;
    searchPlaceholder?: string;
    /** Shown when there are no facet rows at all */
    noDataMessage?: string;
    /** Shown when search/filter yields no Command items */
    noMatchesMessage?: string;
}

function summaryText(value: string[]): string {
    if (value.length === 0) {
        return t('common', 'listFilterAny');
    }
    if (value.length === 1) {
        return value[0]!;
    }
    if (value.length === 2) {
        return `${value[0]}, ${value[1]}`;
    }
    return t('common', 'listFilterNSelected').replace('{{n}}', String(value.length));
}

export function FilterFacetMultiSelectField({
                                                id,
                                                label,
                                                value,
                                                facets,
                                                onChange,
                                                searchPlaceholder,
                                                noDataMessage,
                                                noMatchesMessage,
                                            }: FilterFacetMultiSelectFieldProps) {
    const [open, setOpen] = React.useState(false);

    const toggle = (facetValue: string) => {
        const set = new Set(value);
        if (set.has(facetValue)) set.delete(facetValue);
        else set.add(facetValue);
        onChange(Array.from(set));
    };

    const summary = summaryText(value);

    return (
        <div className="space-y-1.5">
            <Label
                htmlFor={`${id}-trigger`}
                className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
            >
                {label}
            </Label>
            <Popover open={open} onOpenChange={setOpen} modal={false}>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        id={`${id}-trigger`}
                        className={cn(
                            'h-8 w-full justify-between gap-1 px-2.5 font-normal text-[13px]',
                            value.length > 0 && 'text-foreground'
                        )}
                        aria-expanded={open}
                        aria-haspopup="dialog"
                    >
                        <span className="truncate text-left">{summary}</span>
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50"/>
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                    align="start"
                    sideOffset={4}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                >
                    {facets.length === 0 ? (
                        <p className="px-3 py-2.5 text-[13px] text-muted-foreground">
                            {noDataMessage ?? t('common', 'listFilterFacetNoData')}
                        </p>
                    ) : (
                        <Command className="rounded-md border-0 shadow-none">
                            <CommandInput
                                placeholder={
                                    searchPlaceholder ?? t('common', 'listFilterFacetSearchPlaceholder')
                                }
                                className="h-9 border-0 text-[13px]"
                            />
                            <CommandList>
                                <CommandEmpty>
                                    {noMatchesMessage ?? t('common', 'listFilterFacetNoMatches')}
                                </CommandEmpty>
                                <CommandGroup>
                                    {facets.map((f) => {
                                        const selected = value.includes(f.value);
                                        return (
                                            <CommandItem
                                                key={f.value}
                                                value={f.value}
                                                onSelect={() => toggle(f.value)}
                                                className="gap-2 text-[13px]"
                                            >
                                                <span
                                                    className={cn(
                                                        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-primary',
                                                        selected
                                                            ? 'bg-primary text-primary-foreground'
                                                            : 'border-muted-foreground/40'
                                                    )}
                                                    aria-hidden
                                                >
                                                    {selected ? (
                                                        <Check className="h-2.5 w-2.5 stroke-[3]"/>
                                                    ) : null}
                                                </span>
                                                <span className="min-w-0 flex-1 truncate">{f.value}</span>
                                                <span className="shrink-0 text-muted-foreground">
                                                    ({f.count})
                                                </span>
                                            </CommandItem>
                                        );
                                    })}
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    )}
                </PopoverContent>
            </Popover>
        </div>
    );
}
