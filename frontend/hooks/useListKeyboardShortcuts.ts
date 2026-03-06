import {useEffect} from 'react';

export interface UseListKeyboardShortcutsOptions {
    searchInputRef: React.RefObject<HTMLInputElement | null>;
    setFilterPopoverOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
    filterPopoverOpen: boolean;
    deselectAll?: () => void;
    selectedCount?: number;
    hasActiveFilters?: boolean;
    selectAll?: () => void;
    selectFiltered?: () => void;
}

/**
 * List toolbar keyboard shortcuts: ⌘K focus search, F toggle filter,
 * Escape close popover then clear selection, ⌘A select all visible.
 * Only handles when focus is not in input/textarea.
 */
export function useListKeyboardShortcuts({
                                             searchInputRef,
                                             setFilterPopoverOpen,
                                             filterPopoverOpen,
                                             deselectAll,
                                             selectedCount = 0,
                                             hasActiveFilters = false,
                                             selectAll,
                                             selectFiltered,
                                         }: UseListKeyboardShortcutsOptions) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const inInput =
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable;

            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                searchInputRef.current?.focus();
                return;
            }
            if (
                e.key === 'f' &&
                !e.metaKey &&
                !e.ctrlKey &&
                !e.altKey &&
                !inInput
            ) {
                e.preventDefault();
                setFilterPopoverOpen((prev) => !prev);
                return;
            }
            if (e.key === 'Escape') {
                if (filterPopoverOpen) {
                    e.preventDefault();
                    setFilterPopoverOpen(false);
                    return;
                }
                if (selectedCount > 0 && deselectAll) {
                    e.preventDefault();
                    deselectAll();
                    return;
                }
                return;
            }
            if (
                (e.metaKey || e.ctrlKey) &&
                e.key === 'a' &&
                !inInput &&
                selectAll &&
                selectFiltered
            ) {
                e.preventDefault();
                if (hasActiveFilters) {
                    selectFiltered();
                } else {
                    selectAll();
                }
                return;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        searchInputRef,
        setFilterPopoverOpen,
        filterPopoverOpen,
        deselectAll,
        selectedCount,
        hasActiveFilters,
        selectAll,
        selectFiltered,
    ]);
}
