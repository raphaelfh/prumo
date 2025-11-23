/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Helpers para cálculos de progresso
 * 
 * Funções reutilizáveis para cálculos relacionados a progresso de extração.
 */

/**
 * Calcula percentual de progresso
 * 
 * @param completed - Número de itens completados
 * @param total - Número total de itens
 * @returns Percentual (0-100) arredondado
 */
export function calculateProgressPercent(completed: number, total: number): number {
  if (total === 0) {
    return 0;
  }
  return Math.round((completed / total) * 100);
}






