// frontend/test/SectionAccordion.flat.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SectionAccordion } from '@/components/extraction/SectionAccordion';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

const entityType = {
  id: 'et1', template_id: 't', name: 'participants', label: 'Participants', description: null,
  parent_entity_type_id: null, cardinality: 'one' as const, role: 'study_section' as const,
  sort_order: 0, is_required: true, created_at: '',
};

describe('SectionAccordion flat header', () => {
  it('does not wrap the section in the heavy bg-card border-l-4 card', () => {
    const { container } = render(
      <SectionAccordion
        entityType={entityType} instances={[]} fields={[]} values={{}}
        onValueChange={() => {}} projectId="p" articleId="a" templateId="t"
      />,
    );
    expect(container.querySelector('.border-l-4')).toBeNull();
    expect(container.querySelector('.bg-card')).toBeNull();
  });
});
