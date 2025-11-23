import { describe, it, expect } from 'vitest';
import { normalizeSingle, normalizeMulti } from '@/lib/validations/selectOther';

describe('Other (especificar) lightweight flow', () => {
  it('single select: selecting other carries free text', () => {
    const v = normalizeSingle({ selected: 'other', other_text: 'Registro X' });
    expect(v && typeof v === 'object' && (v as any).other_text).toBe('Registro X');
  });

  it('multi select: accumulates options and other texts', () => {
    const v = normalizeMulti({ selected: ['A'], other_texts: ['Livre 1', 'Livre 2'] });
    expect(v && typeof v === 'object' && (v as any).other_texts.length).toBe(2);
  });
});









