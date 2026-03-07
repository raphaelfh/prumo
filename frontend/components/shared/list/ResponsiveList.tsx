import * as React from 'react';
import {DataTableWrapper} from './DataTableWrapper';

export interface ResponsiveListProps {
    isNarrow: boolean;
    tableContent: React.ReactNode;
    cardContent: React.ReactNode;
}

/**
 * Renders card list when isNarrow (viewport < sm), else table wrapped in DataTableWrapper.
 * Centralizes table-vs-cards switch so callers do not repeat the conditional.
 */
export function ResponsiveList({isNarrow, tableContent, cardContent}: ResponsiveListProps) {
    if (isNarrow) {
        return <div className="rounded-md overflow-hidden w-full border border-border/40">{cardContent}</div>;
    }
    return <DataTableWrapper>{tableContent}</DataTableWrapper>;
}
