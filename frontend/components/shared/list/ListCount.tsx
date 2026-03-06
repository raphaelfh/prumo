import * as React from 'react';
import {t} from '@/lib/copy';

interface ListCountProps {
    visible: number;
    total: number;
    label: string;
    className?: string;
}

export function ListCount({visible, total, label, className}: ListCountProps) {
    return (
        <span
            className={className ?? 'text-[11px] text-muted-foreground tabular-nums'}
        >
      {visible} {t('common', 'of')} {total} {label}
    </span>
    );
}
