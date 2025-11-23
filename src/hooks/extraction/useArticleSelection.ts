/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Hook para gerenciar seleção de artigos na tabela
 * 
 * Fornece lógica reutilizável para seleção individual, seleção de todos,
 * seleção de artigos filtrados e gerenciamento de estado.
 */

import { useState, useCallback, useMemo } from 'react';

interface UseArticleSelectionOptions {
  /**
   * IDs de todos os artigos disponíveis (não filtrados)
   */
  allArticleIds: string[];
  
  /**
   * IDs dos artigos atualmente visíveis (após filtros/ordenação)
   */
  visibleArticleIds: string[];
}

interface UseArticleSelectionReturn {
  /**
   * Set de IDs dos artigos selecionados
   */
  selectedIds: Set<string>;
  
  /**
   * Se todos os artigos visíveis estão selecionados
   */
  isAllSelected: boolean;
  
  /**
   * Se alguns (mas não todos) artigos visíveis estão selecionados
   */
  isIndeterminate: boolean;
  
  /**
   * Número de artigos selecionados
   */
  selectedCount: number;
  
  /**
   * Alterna seleção de um artigo específico
   */
  toggleArticle: (articleId: string) => void;
  
  /**
   * Seleciona todos os artigos visíveis
   */
  selectAll: () => void;
  
  /**
   * Seleciona apenas os artigos visíveis (filtrados)
   */
  selectFiltered: () => void;
  
  /**
   * Remove seleção de todos os artigos
   */
  deselectAll: () => void;
  
  /**
   * Verifica se um artigo específico está selecionado
   */
  isSelected: (articleId: string) => boolean;
  
  /**
   * Verifica se há filtros ativos (diferença entre all e visible)
   */
  hasActiveFilters: boolean;
}

/**
 * Hook para gerenciar seleção de artigos
 */
export function useArticleSelection({
  allArticleIds,
  visibleArticleIds,
}: UseArticleSelectionOptions): UseArticleSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Verifica se há filtros ativos
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

  // Alterna seleção de um artigo
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

  // Seleciona todos os artigos visíveis
  const selectAll = useCallback(() => {
    setSelectedIds(new Set(visibleArticleIds));
  }, [visibleArticleIds]);

  // Seleciona apenas os artigos visíveis (filtrados)
  const selectFiltered = useCallback(() => {
    setSelectedIds(new Set(visibleArticleIds));
  }, [visibleArticleIds]);

  // Remove seleção de todos
  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Verifica se um artigo está selecionado
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




