import * as React from 'react';
import {Checkbox} from '@/components/ui/checkbox';
import {Label} from '@/components/ui/label';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {ChevronDown} from 'lucide-react';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

interface FilterCategoricalFieldProps {
    id: string;
    label: string;
    options: { value: string; label: string }[];
    value: string[];
    onChange: (value: string[]) => void;
    counts?: Record<string, number>;
}

function triggerSummary(
    value: string[],
    options: { value: string; label: string }[]
): string {
    if (value.length === 0) {
        return t('common', 'listFilterAny');
    }
    const labels = value
        .map((v) => options.find((o) => o.value === v)?.label ?? v)
        .filter(Boolean);
    if (labels.length === 1) {
        return labels[0]!;
    }
    if (labels.length === 2) {
        return `${labels[0]}, ${labels[1]}`;
    }
    return t('common', 'listFilterNSelected').replace('{{n}}', String(value.length));
}

export function FilterCategoricalField({
                                           id,
                                           label,
                                           options,
                                           value,
                                           onChange,
                                           counts,
                                       }: FilterCategoricalFieldProps) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const searchInputRef = React.useRef<HTMLInputElement>(null);

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        if (!next) setQuery('');
    };

    const q = query.trim().toLowerCase();
    const filteredOptions = React.useMemo(() => {
        if (!q) return options;
        return options.filter(
            (o) =>
                o.label.toLowerCase().includes(q) ||
                o.value.toLowerCase().includes(q)
        );
    }, [options, q]);

    const toggle = (optValue: string) => {
        const set = new Set(value);
        if (set.has(optValue)) set.delete(optValue);
        else set.add(optValue);
        onChange(Array.from(set));
    };

    const summary = triggerSummary(value, options);

    return (
        <div className="space-y-1.5">
            <Label
                htmlFor={`${id}-trigger`}
                className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
            >
                {label}
            </Label>
            <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
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
                    onOpenAutoFocus={(e) => {
                        e.preventDefault();
                        queueMicrotask(() => searchInputRef.current?.focus());
                    }}
                >
                    <div className="border-b border-border/60 px-2 py-1.5">
                        <Input
                            ref={searchInputRef}
                            id={`${id}-option-search`}
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t('common', 'listFilterFacetSearchPlaceholder')}
                            aria-label={t('common', 'listFilterSearchOptionsAria')}
                            className="h-7 border-0 bg-transparent px-1.5 text-[12px] shadow-none placeholder:text-muted-foreground/80 focus-visible:ring-0 focus-visible:ring-offset-0"
                        />
                    </div>
                    <div
                        className="max-h-48 space-y-1 overflow-y-auto p-2 pr-1.5"
                        role="group"
                        aria-label={label}
                    >
                        {filteredOptions.length === 0 ? (
                            <p className="px-1 py-2 text-center text-[12px] text-muted-foreground">
                                {t('common', 'listFilterFacetNoMatches')}
                            </p>
                        ) : (
                            filteredOptions.map((opt) => (
                                <label
                                    key={opt.value}
                                    className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 text-[13px] hover:bg-muted/60"
                                >
                                    <Checkbox
                                        checked={value.includes(opt.value)}
                                        onCheckedChange={() => toggle(opt.value)}
                                        className="h-3.5 w-3.5 rounded-sm"
                                    />
                                    <span className="min-w-0 flex-1 truncate">
                                        {opt.label}
                                        {counts && counts[opt.value] != null && (
                                            <span className="ml-1 text-muted-foreground">
                                                ({counts[opt.value]})
                                            </span>
                                        )}
                                    </span>
                                </label>
                            ))
                        )}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
