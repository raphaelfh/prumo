import {describe, expect, it} from 'vitest';
import {ExtractionFieldSchema} from '@/types/extraction';

describe('ExtractionFieldSchema — disposition flags', () => {
  it('flags are optional (mirroring allow_other) and round-trip when set', () => {
    // Optional like allow_other → undefined when omitted; writers always set
    // an explicit boolean, and the DB column server_default false backfills.
    const base = ExtractionFieldSchema.parse({ name: 'field_a', label: 'X', field_type: 'text' });
    expect(base.allows_not_applicable).toBeUndefined();
    expect(base.allows_not_evaluated).toBeUndefined();

    const enabled = ExtractionFieldSchema.parse({
      name: 'field_a',
      label: 'X',
      field_type: 'text',
      allows_not_evaluated: true,
    });
    expect(enabled.allows_not_evaluated).toBe(true);
  });
});

describe('ExtractionField - allow_other flags', () => {
  it('accepts allow_other for select', () => {
    const parsed = ExtractionFieldSchema.safeParse({
      name: 'origem_dados',
      label: 'Origem dos Dados',
      field_type: 'select',
      is_required: false,
      allowed_values: ['Registro A', 'Registro B'],
      allow_other: true,
      other_label: 'Outro (especificar)',
      other_placeholder: 'Digite a origem',
      sort_order: 0,
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts allow_other for multiselect', () => {
    const parsed = ExtractionFieldSchema.safeParse({
      name: 'origem_dados_multi',
      label: 'Origem dos Dados (Multi)',
      field_type: 'multiselect',
      is_required: false,
      allowed_values: ['Registro A', 'Registro B'],
      allow_other: true,
      sort_order: 0,
    });
    expect(parsed.success).toBe(true);
  });
});









