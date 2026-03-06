/**
 * Hook to manage article selection in the table
 *
 * Provides reusable logic for single selection, select all,
 * filtered selection and state management.
 */

import {useCallback, useMemo, useState} from 'react';

interface UseArticleSelectionOptions {
  /**
   * IDs of all available articles (unfiltered)
   */
  allArticleIds: string[];
  
  /**
   * IDs of currently visible articles (after filters/sort)
   */
  visibleArticleIds: string[];
}

interface UseArticleSelectionReturn {
  /**
   * Set of selected article IDs
   */
  selectedIds: Set<string>;
  
  /**
   * Whether all visible articles are selected
   */
  isAllSelected: boolean;
  
  /**
   * Whether some (but not all) visible articles are selected
   */
  isIndeterminate: boolean;
  
  /**
   * Number of selected articles
   */
  selectedCount: number;
  
  /**
   * Toggle selection of a specific article
   */
  toggleArticle: (articleId: string) => void;
  
  /**
   * Select all visible articles
   */
  selectAll: () => void;
  
  /**
   * Select only visible (filtered) articles
   */
  selectFiltered: () => void;
  
  /**
   * Clear selection of all articles
   */
  deselectAll: () => void;
  
  /**
   * Check if a specific article is selected
   */
  isSelected: (articleId: string) => boolean;
  
  /**
   * Whether there are active filters (difference between all and visible)
   */
  hasActiveFilters: boolean;
}

/**
 * Hook to manage article selection
 */
export function useArticleSelection({
  allArticleIds,
  visibleArticleIds,
}: UseArticleSelectionOptions): UseArticleSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Check for active filters
  const hasActiveFilters = useMemo(() => {
    return allArticleIds.length !== visibleArticleIds.length ||
           !visibleArticleIds.every(id => allArticleIds.includes(id));
  }, [allArticleIds, visibleArticleIds]);

  // Calcula estados do checkbox do header
  const isAllSelected = useMemo(() => {
    if (visibleArticleIds.length === 0) return false;
    return visibleArticleIds.every(id => selectedIds.has(id));
  }, [visibleArticleIds, selectedIds]);

  const isIndeterminate = useMemo(() => {
    const selectedVisibleCount = visibleArticleIds.filter(id => selectedIds.has(id)).length;
    return selectedVisibleCount > 0 && selectedVisibleCount < visibleArticleIds.length;
  }, [visibleArticleIds, selectedIds]);

  const selectedCount = selectedIds.size;

    // Toggle selection of an article
  const toggleArticle = useCallback((articleId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(articleId)) {
        next.delete(articleId);
      } else {
        next.add(articleId);
      }
      return next;
    });
  }, []);

    // Select all visible articles
  const selectAll = useCallback(() => {
    setSelectedIds(new Set(visibleArticleIds));
  }, [visibleArticleIds]);

    // Select only visible (filtered) articles
  const selectFiltered = useCallback(() => {
    setSelectedIds(new Set(visibleArticleIds));
  }, [visibleArticleIds]);

    // Clear all selection
  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

    // Check if an article is selected
  const isSelected = useCallback((articleId: string) => {
    return selectedIds.has(articleId);
  }, [selectedIds]);

  return {
    selectedIds,
    isAllSelected,
    isIndeterminate,
    selectedCount,
    toggleArticle,
    selectAll,
    selectFiltered,
    deselectAll,
    isSelected,
    hasActiveFilters,
  };
}




