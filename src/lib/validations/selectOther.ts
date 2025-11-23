import { z } from 'zod';

// =================== CONSTANTS ===================

/**
 * Valor especial usado internamente no Select para representar opção "Outro"
 * Não é salvo no banco, apenas usado para controle de UI
 */
export const OTHER_OPTION_VALUE = '__OTHER__';

// =================== SCHEMAS ===================

export const SingleWithOtherSchema = z.union([
  z.string().min(1),
  z.object({ selected: z.literal('other'), other_text: z.string().trim().min(1).max(200) }),
  z.null()
]);

export const MultiWithOtherSchema = z.union([
  z.array(z.string().min(1)),
  z.object({ selected: z.array(z.string().min(1)).default([]), other_texts: z.array(z.string().trim().min(1).max(200)).default([]) }),
  z.null()
]);

// =================== TYPE GUARDS ===================

/**
 * Verifica se um valor é do tipo "outro" (single select)
 * Aceita other_text vazio para permitir detecção imediata ao selecionar "Other"
 */
export function isSingleOtherValue(value: any): value is { selected: 'other'; other_text: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'selected' in value &&
    value.selected === 'other' &&
    'other_text' in value
  );
}

/**
 * Verifica se um valor é um objeto "outro" (mesmo com other_text vazio)
 * Usado para detectar quando usuário acabou de selecionar "Other"
 */
export function isOtherObject(value: any): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'selected' in value &&
    value.selected === 'other'
  );
}

/**
 * Verifica se um valor é do tipo "outro" (multi select)
 */
export function isMultiOtherValue(value: any): value is { selected: string[]; other_texts: string[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'selected' in value &&
    Array.isArray(value.selected) &&
    'other_texts' in value &&
    Array.isArray(value.other_texts)
  );
}

/**
 * Verifica se um valor é do tipo "outro" (single ou multi)
 */
export function isOtherValue(value: any): boolean {
  return isSingleOtherValue(value) || isMultiOtherValue(value);
}

/**
 * Verifica se um valor do banco (jsonb) é do tipo "outro"
 * O valor pode estar em { value: {...} } ou diretamente
 */
export function isOtherValueFromDb(dbValue: any): boolean {
  if (!dbValue || typeof dbValue !== 'object') return false;
  
  // Se está em wrapper { value: {...} }
  const actualValue = 'value' in dbValue ? dbValue.value : dbValue;
  
  return isOtherValue(actualValue);
}

// =================== NORMALIZATION ===================

export function normalizeSingle(value: any): string | { selected: 'other'; other_text: string } | null {
  const parsed = SingleWithOtherSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function normalizeMulti(value: any): string[] | { selected: string[]; other_texts: string[] } | null {
  const parsed = MultiWithOtherSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function serializeSingle(value: any): string | { selected: 'other'; other_text: string } | null {
  return normalizeSingle(value);
}

export function serializeMulti(value: any): string[] | { selected: string[]; other_texts: string[] } | null {
  return normalizeMulti(value);
}

// =================== VALUE EXTRACTION (DRY) ===================

/**
 * Extrai valor e unit de um valueData, preservando valores "outro"
 * Usado ao salvar extracted_values no banco
 */
export interface ExtractedValueResult {
  value: any; // Valor a salvar (pode ser objeto "outro" ou valor simples)
  unit: string | null;
  isOther: boolean;
}

export function extractValueForSave(valueData: any): ExtractedValueResult {
  // Detectar se é valor "outro"
  const isOther = isOtherValue(valueData);

  if (isOther) {
    // Preservar estrutura completa
    return {
      value: valueData,
      unit: null,
      isOther: true
    };
  }

  // Verificar se é objeto com unit (number field)
  if (typeof valueData === 'object' && valueData !== null && 'value' in valueData) {
    return {
      value: valueData.value,
      unit: 'unit' in valueData ? valueData.unit : null,
      isOther: false
    };
  }

  // Valor simples
  return {
    value: valueData,
    unit: null,
    isOther: false
  };
}

/**
 * Extrai valor de um item do banco (jsonb), preservando valores "outro"
 * Usado ao carregar extracted_values do banco
 */
export function extractValueFromDb(item: { value: any; unit?: string | null }): any {
  const dbValue = item.value;
  
  // Verificar se já é objeto com "outro"
  if (isOtherValueFromDb(dbValue)) {
    // Extrair do wrapper se necessário
    const actualValue = 'value' in dbValue ? dbValue.value : dbValue;
    return actualValue; // Preservar objeto "outro"
  }

  // Extrair valor do wrapper { value: X } se existir
  const extractedValue = dbValue && typeof dbValue === 'object' && 'value' in dbValue
    ? dbValue.value
    : dbValue;

  // Se tiver unit (number field), retornar objeto { value, unit }
  if (item.unit) {
    return { value: extractedValue, unit: item.unit };
  }

  return extractedValue;
}


