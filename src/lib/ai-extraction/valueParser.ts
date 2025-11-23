/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Utilitários para parsing e normalização de valores
 * 
 * Funções puras para trabalhar com valores de extração que podem estar
 * em diferentes formatos (objeto {value, unit}, valor direto, etc.)
 * 
 * @example
 * ```typescript
 * // Extrair valor de objeto ou valor direto
 * const value = extractValue({ value: 42, unit: 'kg' }); // 42
 * const simple = extractValue(42); // 42
 * 
 * // Verificar se está vazio
 * if (isEmptyValue(value)) {
 *   console.log('Valor vazio');
 * }
 * 
 * // Validar número
 * if (isValidNumber(value)) {
 *   const num = toNumber(value); // number | null
 * }
 * ```
 */

/**
 * Extrai o valor de um objeto {value, unit} ou retorna o valor direto
 * 
 * @param value - Valor que pode ser objeto ou valor direto
 * @returns Valor extraído ou valor original
 */
export function extractValue(value: any): any {
  if (value === null || value === undefined) {
    return null;
  }

  // Se for objeto com propriedade 'value', extrair o valor
  if (typeof value === 'object' && 'value' in value) {
    return value.value;
  }

  // Caso contrário, retornar o valor direto
  return value;
}

/**
 * Extrai a unidade de um valor (se for objeto {value, unit})
 * 
 * @param value - Valor que pode ser objeto ou valor direto
 * @returns Unidade se disponível, null caso contrário
 */
export function extractUnit(value: any): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'object' && 'unit' in value) {
    return value.unit || null;
  }

  return null;
}

/**
 * Verifica se um valor está vazio (null, undefined ou string vazia)
 * 
 * @param value - Valor a verificar
 * @returns true se o valor está vazio
 */
export function isEmptyValue(value: any): boolean {
  const extracted = extractValue(value);
  return extracted === null || extracted === undefined || extracted === '';
}

/**
 * Normaliza um valor para formato padrão
 * 
 * Converte valores vazios para null e garante formato consistente.
 * 
 * @param value - Valor a normalizar
 * @returns Valor normalizado
 */
export function normalizeValue(value: any): any {
  if (isEmptyValue(value)) {
    return null;
  }

  return extractValue(value);
}

/**
 * Valida se um valor é um número válido
 * 
 * @param value - Valor a validar
 * @returns true se for um número válido
 */
export function isValidNumber(value: any): boolean {
  const extracted = extractValue(value);
  
  if (extracted === null || extracted === undefined || extracted === '') {
    return false; // Valores vazios não são números válidos
  }

  return !isNaN(Number(extracted));
}

/**
 * Converte valor para número, retornando null se inválido
 * 
 * @param value - Valor a converter
 * @returns Número ou null se inválido
 */
export function toNumber(value: any): number | null {
  if (!isValidNumber(value)) {
    return null;
  }

  return Number(extractValue(value));
}

/**
 * Converte valor para string, tratando valores nulos/vazios
 * 
 * @param value - Valor a converter
 * @param emptyPlaceholder - Texto para exibir quando vazio (padrão: '')
 * @returns String representando o valor
 */
export function toString(value: any, emptyPlaceholder: string = ''): string {
  const extracted = extractValue(value);

  if (extracted === null || extracted === undefined) {
    return emptyPlaceholder;
  }

  if (extracted === '') {
    return emptyPlaceholder;
  }

  return String(extracted);
}

