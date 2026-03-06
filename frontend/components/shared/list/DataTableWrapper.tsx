import * as React from 'react';

interface DataTableWrapperProps {
    children: React.ReactNode;
    className?: string;
}

export function DataTableWrapper({children, className}: DataTableWrapperProps) {
    return (
        <div
            className={
                className ??
                'rounded-md overflow-hidden w-full border-b border-border/40'
            }
        >
            <div className="overflow-x-auto min-w-0">{children}</div>
        </div>
    );
}
