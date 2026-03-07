import * as React from 'react';
import {cn} from '@/lib/utils';

export interface ListRowCardProps {
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    meta?: React.ReactNode;
    primaryAction: React.ReactNode;
    secondaryActions?: React.ReactNode;
    leading?: React.ReactNode;
    onClick?: () => void;
    className?: string;
}

/**
 * Presentational card for one list row on narrow viewports (xs, below sm).
 * frontend-ux: text-[13px], border-border/40, hover:bg-muted/50, duration-75.
 */
export function ListRowCard({
                                title,
                                subtitle,
                                meta,
                                primaryAction,
                                secondaryActions,
                                leading,
                                onClick,
                                className,
                            }: ListRowCardProps) {
    const content = (
        <>
            {leading && (
                <div className="flex-shrink-0 flex items-center" onClick={(e) => e.stopPropagation()}>
                    {leading}
                </div>
            )}
            <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-foreground truncate">{title}</div>
                {subtitle != null && (
                    <div className="text-[13px] text-muted-foreground truncate mt-0.5">{subtitle}</div>
                )}
                {meta != null && (
                    <div className="text-[13px] text-muted-foreground flex items-center gap-2 mt-1 flex-wrap">
                        {meta}
                    </div>
                )}
            </div>
            <div className="flex-shrink-0 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                {primaryAction}
                {secondaryActions}
            </div>
        </>
    );

    const wrapperClass = cn(
        'flex items-center gap-3 py-2 px-2 border-b border-border/40',
        'hover:bg-muted/50 transition-[background-color] duration-75',
        onClick && 'cursor-pointer',
        className
    );

    if (onClick) {
        return (
            <div role="button" tabIndex={0} className={wrapperClass} onClick={onClick}
                 onKeyDown={(e) => e.key === 'Enter' && onClick()}>
                {content}
            </div>
        );
    }

    return <div className={wrapperClass}>{content}</div>;
}
