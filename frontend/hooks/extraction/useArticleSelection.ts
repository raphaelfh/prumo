/**
 * Hook to manage article selection in the table
 *
 * Provides reusable logic for single selection, select all,
 * filtered selection and state management.
 */

import {useState} from 'react';

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

  const hasActiveFilters =
    allArticleIds.length !== visibleArticleIds.length ||
    !visibleArticleIds.every(id => allArticleIds.includes(id));

  const isAllSelected =
    visibleArticleIds.length > 0 && visibleArticleIds.every(id => selectedIds.has(id));

  const selectedVisibleCount = visibleArticleIds.filter(id => selectedIds.has(id)).length;
  const isIndeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleArticleIds.length;

  const selectedCount = selectedIds.size;

  const toggleArticle = (articleId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(articleId)) {
        next.delete(articleId);
      } else {
        next.add(articleId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(visibleArticleIds));
  };

  const selectFiltered = () => {
    setSelectedIds(new Set(visibleArticleIds));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const isSelected = (articleId: string) => {
    return selectedIds.has(articleId);
  };

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




