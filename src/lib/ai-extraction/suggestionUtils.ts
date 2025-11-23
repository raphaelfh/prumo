/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Utilitários para formatação e manipulação de sugestões de IA
 * 
 * Funções puras para formatação de valores de sugestões para exibição na UI.
 * 
 * @example
 * ```typescript
 * // Calcular porcentagem de confiança
 * const percent = calculateConfidencePercent(0.85); // 85
 * 
 * // Formatar valor para exibição
 * const display = formatSuggestionValue(suggestion.value, 40); // "(vazio)" | "Texto..."
 * 
 * // Filtrar por threshold
 * const highConfidence = filterSuggestionsByConfidence(suggestions, 0.8);
 * ```
 */

import type { AISuggestion } from '@/types/ai-extraction';

/**
 * Calcula a porcentagem de confiança formatada
 * 
 * @param confidence - Valor de confiança (0-1)
 * @returns Porcentagem arredondada (0-100)
 */
export function calculateConfidencePercent(confidence: number): number {
  return Math.round(confidence * 100);
}

/**
 * Formata valor de sugestão para exibição
 * 
 * Converte valores para string de forma legível, truncando se necessário.
 * 
 * @param value - Valor a formatar
 * @param maxLength - Comprimento máximo (padrão: 40)
 * @returns String formatada
 */
export function formatSuggestionValue(value: any, maxLength: number = 40): string {
  // String vazia também é um valor válido - mostrar como "(vazio)" apenas se for realmente null/undefined
  if (value === null || value === undefined) {
    return '(vazio)';
  }

  if (value === '') {
    return '(vazio)';
  }

  if (typeof value === 'boolean') {
    return value ? 'Sim' : 'Não';
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'object') {
    const str = JSON.stringify(value);
    return str.length > maxLength
      ? `${str.substring(0, maxLength)}...`
      : str;
  }

  const str = String(value);
  return str.length > maxLength
    ? `${str.substring(0, maxLength)}...`
    : str;
}

/**
 * Obtém o valor completo formatado para tooltip/exibição expandida
 * 
 * @param value - Valor a formatar
 * @returns String completa do valor
 */
export function formatFullSuggestionValue(value: any): string {
  if (value === null || value === undefined) {
    return '(vazio)';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  return JSON.stringify(value);
}

/**
 * Verifica se uma sugestão foi aceita
 * 
 * @param suggestion - Sugestão a verificar
 * @returns true se a sugestão está com status 'accepted'
 */
export function isSuggestionAccepted(suggestion: AISuggestion): boolean {
  return suggestion.status === 'accepted';
}

/**
 * Verifica se uma sugestão está pendente
 * 
 * @param suggestion - Sugestão a verificar
 * @returns true se a sugestão está com status 'pending'
 */
export function isSuggestionPending(suggestion: AISuggestion): boolean {
  return suggestion.status === 'pending';
}

/**
 * Filtra sugestões por threshold de confiança
 * 
 * @param suggestions - Record de sugestões
 * @param threshold - Threshold mínimo de confiança (0-1, padrão: 0.8)
 * @returns Array de [key, suggestion] filtradas
 */
export function filterSuggestionsByConfidence(
  suggestions: Record<string, AISuggestion>,
  threshold: number = 0.8
): Array<[string, AISuggestion]> {
  return Object.entries(suggestions).filter(
    ([, suggestion]) => suggestion.confidence >= threshold
  );
}

/**
 * Ordena sugestões por confiança (maior primeiro)
 * 
 * @param suggestions - Record de sugestões
 * @returns Array de [key, suggestion] ordenadas
 */
export function sortSuggestionsByConfidence(
  suggestions: Record<string, AISuggestion>
): Array<[string, AISuggestion]> {
  return Object.entries(suggestions).sort(
    ([, a], [, b]) => b.confidence - a.confidence
  );
}

