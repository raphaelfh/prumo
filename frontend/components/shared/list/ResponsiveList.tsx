import * as React from 'react';

export interface ResponsiveListProps {
    isNarrow: boolean;
    tableContent: React.ReactNode;
    cardContent: React.ReactNode;
}

/**
 * Switches between card list (isNarrow, viewport < sm) and table content.
 * The caller owns the scroll container + border framing; the table mode renders
 * its content directly so the scroll/sticky-header chain is not broken by an
 * intermediate overflow wrapper. Centralizes the table-vs-cards switch so
 * callers do not repeat the conditional.
 */
export function ResponsiveList({isNarrow, tableContent, cardContent}: ResponsiveListProps) {
    return <>{isNarrow ? cardContent : tableContent}</>;
}
