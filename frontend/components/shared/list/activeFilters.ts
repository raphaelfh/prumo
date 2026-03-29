/**
 * Helper to build the list of active filters for the chip bar from FilterFieldConfig + FilterValues.
 * Used by Articles, Extraction (and optionally Assessment) to drive ActiveFilterChips.
 */

import type {FilterFieldConfig, FilterValues} from './filter-types';

export interface ActiveFilterChip {
    column: string;
    label: string;
    value: string;
}

export function buildActiveFiltersList(
    fields: FilterFieldConfig[],
    values: FilterValues,
    labels?: Record<string, string>
): ActiveFilterChip[] {
    const list: ActiveFilterChip[] = [];
    fields.forEach((f) => {
        const v = values[f.id];
        const label = labels?.[f.id] ?? f.label;
        if (f.type === 'categorical' && Array.isArray(v) && v.length > 0) {
            v.forEach((val) => {
                const opt = f.options?.find((o) => o.value === val);
                list.push({column: f.id, label, value: opt?.label ?? val});
            });
        } else if (f.type === 'facetMultiSelect' && Array.isArray(v) && v.length > 0) {
            v.forEach((val) => {
                list.push({column: f.id, label, value: val});
            });
        } else if (f.type === 'numericRange' && v != null && typeof v === 'object' && !Array.isArray(v)) {
            const r = v as { min?: number; max?: number };
            if (r.min != null || r.max != null) {
                const from = r.min != null ? String(r.min) : '?';
                const to = r.max != null ? String(r.max) : '?';
                list.push({column: f.id, label, value: `${from}–${to}`});
            }
        } else if (typeof v === 'string' && v.trim() !== '') {
            list.push({column: f.id, label, value: v.trim()});
        }
    });
    return list;
}
