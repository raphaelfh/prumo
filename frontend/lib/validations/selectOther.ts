import {z} from 'zod';

// =================== CONSTANTS ===================

/**
 * Special value used internally in Select for the "Other" option
 * Not stored in DB, only used for UI control
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
 * Checks if a value is "other" type (single select)
 * Accepts empty other_text to allow immediate detection when selecting "Other"
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
 * Checks if a value is an "other" object (even with empty other_text)
 * Used to detect when user has just selected "Other"
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
 * Checks if a value is "other" type (multi select)
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
 * Checks if a value is "other" type (single or multi)
 */
export function isOtherValue(value: any): boolean {
  return isSingleOtherValue(value) || isMultiOtherValue(value);
}

/**
 * Checks if a DB value (jsonb) is "other" type
 * Value may be in { value: {...} } or directly
 */
export function isOtherValueFromDb(dbValue: any): boolean {
  if (!dbValue || typeof dbValue !== 'object') return false;

    // If inside wrapper { value: {...} }
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
 * Extracts value and unit from valueData, preserving "other" values
 * Used when saving extracted_values to DB
 */
export interface ExtractedValueResult {
    value: any; // Value to save (can be "other" object or simple value)
  unit: string | null;
  isOther: boolean;
}

export function extractValueForSave(valueData: any): ExtractedValueResult {
    // Detect if it is "other" value
  const isOther = isOtherValue(valueData);

  if (isOther) {
      // Preserve full structure
    return {
      value: valueData,
      unit: null,
      isOther: true
    };
  }

    // Check if object with unit (number field)
  if (typeof valueData === 'object' && valueData !== null && 'value' in valueData) {
    return {
      value: valueData.value,
      unit: 'unit' in valueData ? valueData.unit : null,
      isOther: false
    };
  }

    // Simple value
  return {
    value: valueData,
    unit: null,
    isOther: false
  };
}

/**
 * Extracts value from a DB item (jsonb), preserving "other" values
 * Used when loading extracted_values from DB
 */
export function extractValueFromDb(item: { value: any; unit?: string | null }): any {
  const dbValue = item.value;

    // Check if already "other" object
  if (isOtherValueFromDb(dbValue)) {
      // Extract from wrapper if needed
    const actualValue = 'value' in dbValue ? dbValue.value : dbValue;
      return actualValue; // Preserve "other" object
  }

    // Extract value from wrapper { value: X } if present
  const extractedValue = dbValue && typeof dbValue === 'object' && 'value' in dbValue
    ? dbValue.value
    : dbValue;

    // If has unit (number field), return object { value, unit }
  if (item.unit) {
    return { value: extractedValue, unit: item.unit };
  }

  return extractedValue;
}


