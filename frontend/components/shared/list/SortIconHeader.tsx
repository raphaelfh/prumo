import {Button} from '@/components/ui/button';
import {ChevronDown, ChevronsUpDown, ChevronUp} from 'lucide-react';

type SortDirection = 'asc' | 'desc';

interface SortIconHeaderProps {
    label: string;
    direction: SortDirection | null;
    onSort: () => void;
    labelClassName?: string;
    iconClassName?: string;
    containerClassName?: string;
    ariaLabel?: string;
}

export function SortIconHeader({
    label,
    direction,
    onSort,
    labelClassName,
    iconClassName,
    containerClassName,
    ariaLabel,
}: SortIconHeaderProps) {
    const icon = direction === 'asc'
        ? <ChevronUp className={iconClassName ?? 'h-3 w-3 text-foreground shrink-0'}/>
        : direction === 'desc'
            ? <ChevronDown className={iconClassName ?? 'h-3 w-3 text-foreground shrink-0'}/>
            : <ChevronsUpDown className={iconClassName ?? 'h-3 w-3 text-muted-foreground opacity-50 shrink-0'}/>;

    return (
        <div className={containerClassName ?? 'flex items-center gap-1'}>
            <span className={labelClassName ?? 'text-[11px] font-medium text-muted-foreground uppercase tracking-wider'}>
                {label}
            </span>
            <Button
                variant="ghost"
                size="icon"
                onClick={onSort}
                aria-label={ariaLabel ?? `Sort by ${label}`}
                className="h-4 w-4 p-0 hover:bg-transparent"
            >
                {icon}
            </Button>
        </div>
    );
}
