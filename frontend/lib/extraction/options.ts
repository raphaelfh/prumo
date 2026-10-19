/**
 * Mirrors backend `normalize_options` (`backend/app/llm/claim_value.py`): the
 * one client-side reader of option shapes. Frozen snapshots and PostgREST
 * reads may still carry `string[]` or `{options: [...]}`.
 */
import type {components} from '@/types/api/schema';

export type OptionItem = components['schemas']['OptionItem'];

function isScalar(v: unknown): v is string | number {
  return (typeof v === 'string' && v !== '') || typeof v === 'number';
}

function toOptionItem(item: unknown): OptionItem | null {
  if (typeof item === 'string') {
    return item.trim() ? {value: item, label: item} : null;
  }
  if (!item || typeof item !== 'object') return null;
  const {value, label} = item as {value?: unknown; label?: unknown};
  if (isScalar(value)) {
    return {value: String(value), label: label ? String(label) : String(value)};
  }
  if (isScalar(label)) return {value: String(label), label: String(label)};
  return null;
}

/** Any stored `allowed_values` shape → `{value, label}[]`; junk items are skipped, order kept. */
export function normalizeOptions(allowedValues: unknown): OptionItem[] {
  const raw =
    allowedValues && typeof allowedValues === 'object' && !Array.isArray(allowedValues) && 'options' in allowedValues
      ? (allowedValues as {options?: unknown}).options
      : allowedValues;
  if (!Array.isArray(raw)) return [];
  return raw.map(toOptionItem).filter((o): o is OptionItem => o !== null);
}

/** Option code → human label. Mirrors backend `option_label_map`. */
export function optionLabelMap(allowedValues: unknown): Map<string, string> {
  return new Map(normalizeOptions(allowedValues).map((o) => [o.value, o.label]));
}
