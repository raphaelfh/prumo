import { describe, it, expect } from 'vitest';
import { ExtractionFieldSchema } from '@/types/extraction';

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









