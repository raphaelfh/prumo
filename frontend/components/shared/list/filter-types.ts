/**
 * Schema and value types for the shared list filter panel.
 * Each list (Articles, Extraction, Assessment) defines its own FilterFieldConfig[]
 * and maps FilterValues to its filter application logic.
 */

export type FilterFieldType = 'text' | 'categorical' | 'numericRange';

export interface FilterFieldConfig {
    id: string;
    label: string;
    type: FilterFieldType;
    placeholder?: string;
    /** For categorical: fixed options */
    options?: { value: string; label: string }[];
    /** For numericRange: optional bounds and step (e.g. year 1900–current) */
    minBound?: number;
    maxBound?: number;
    step?: number;
}

export type FilterValues = Record<
    string,
    string | string[] | { min?: number; max?: number }
>;

export function isFilterValueEmpty(
    value: string | string[] | { min?: number; max?: number } | undefined
): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    const r = value as { min?: number; max?: number };
    return (r.min === undefined || r.min === null) && (r.max === undefined || r.max === null);
}
