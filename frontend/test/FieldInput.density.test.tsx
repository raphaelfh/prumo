import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { FieldInput } from '@/components/extraction/FieldInput';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

const field = {
  id: 'f1', entity_type_id: 'et', name: 'f1', label: 'Recruitment method', description: 'desc',
  field_type: 'text' as const, is_required: true, validation_schema: null, allowed_values: null,
  unit: null, allowed_units: null, llm_description: null, sort_order: 0, created_at: '',
};

describe('FieldInput density', () => {
  it('uses the capped-left container-query grid, not the viewport breakpoint', () => {
    const { container } = render(
      <FieldInput field={field} instanceId="i1" value="" onChange={() => {}} projectId="p" />,
    );
    const row = container.querySelector('[data-field-row]') as HTMLElement;
    expect(row.className).toContain('@md:grid-cols-[minmax(0,232px)_1fr]');
    expect(row.className).not.toContain('sm:grid-cols-[30%_1fr]');
  });
});
