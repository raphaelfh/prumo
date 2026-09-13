import {IconButton} from '@/components/patterns/IconButton';
import {ChevronDown, ChevronsUpDown, ChevronUp} from 'lucide-react';
import {t} from '@/lib/copy';

type SortDirection = 'asc' | 'desc';

interface SortIconHeaderProps {
    label: string;
    direction: SortDirection | null;
    onSort: () => void;
    labelClassName?: string;
    iconClassName?: string;
    containerClassName?: string;
}

export function SortIconHeader({
    label,
    direction,
    onSort,
    labelClassName,
    iconClassName,
    containerClassName,
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
            <IconButton
                label={t('shared', 'listSortBy').replace('{{label}}', label)}
                size="icon-xs"
                onClick={onSort}
                className="hover:bg-transparent"
                icon={icon}
            />
        </div>
    );
}
