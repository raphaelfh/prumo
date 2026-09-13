import type {ExtractionFieldUpdate} from '@/types/extraction';

/**
 * The write for a grid Type-menu pick: the new `field_type` plus a clear for
 * every type-dependent group the NEW type does not support — the field
 * dialog's semantics (options/allow-other only survive select kinds, units
 * only numbers). Pure, so the rule is testable apart from the panel.
 */
export function typeChangeUpdates(fieldType: string): ExtractionFieldUpdate {
  const supportsOptions = fieldType === 'select' || fieldType === 'multiselect';
  return {
    field_type: fieldType as ExtractionFieldUpdate['field_type'],
    ...(supportsOptions
      ? {}
      : {
          allowed_values: null,
          allow_other: false,
          other_label: null,
          other_placeholder: null,
        }),
    ...(fieldType === 'number' ? {} : {unit: null, allowed_units: null}),
  };
}
