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
 *
 * A clickable row is a stretched overlay <button> named by the title, with the
 * leading control and actions raised above it — never a role="button" wrapper
 * around them, because interactive elements must not nest.
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
    const titleId = React.useId();

    return (
        <div
            className={cn(
                'relative flex items-center gap-3 py-2 px-2 border-b border-border/40',
                'hover:bg-muted/50 transition-[background-color] duration-75',
                className
            )}
        >
            {onClick && (
                <button
                    type="button"
                    aria-labelledby={titleId}
                    onClick={onClick}
                    className="absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                />
            )}
            {leading && <div className="relative z-10 shrink-0 flex items-center">{leading}</div>}
            <div className="min-w-0 flex-1">
                <div id={titleId} className="text-[13px] font-medium text-foreground truncate">{title}</div>
                {subtitle != null && (
                    <div className="text-[13px] text-muted-foreground truncate mt-0.5">{subtitle}</div>
                )}
                {meta != null && (
                    <div className="text-[13px] text-muted-foreground flex items-center gap-2 mt-1 flex-wrap">
                        {meta}
                    </div>
                )}
            </div>
            <div className="relative z-10 shrink-0 flex items-center gap-2">
                {primaryAction}
                {secondaryActions}
            </div>
        </div>
    );
}
