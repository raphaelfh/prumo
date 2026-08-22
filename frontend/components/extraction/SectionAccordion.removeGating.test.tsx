import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { SectionAccordion } from '@/components/extraction/SectionAccordion';

// SectionAccordion → useSectionExtraction consumes a QueryClient.
function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const entityType = {
  id: 'et1', template_id: 't', name: 'participants', label: 'Participants', description: null,
  parent_entity_type_id: null, cardinality: 'many' as const, role: 'study_section' as const,
  sort_order: 0, is_required: true, entry_label: null, created_at: '',
};

const instance = {
  id: 'i1',
  entity_type_id: 'et1',
  article_id: 'a',
  template_id: 't',
  label: 'Participants 1',
  metadata: {},
  created_at: '',
};

const baseProps = {
  entityType,
  fields: [],
  values: {},
  onValueChange: vi.fn(),
  projectId: 'p',
  articleId: 'a',
  templateId: 't',
};

describe('SectionAccordion instance-remove gating', () => {
  it('renders no remove button when onRemoveInstance is not provided', () => {
    // The model container is rendered through this component WITHOUT
    // instance handlers (the ModelSelector owns model add/remove); a
    // handler-less accordion must not offer a dead or bypassing trash.
    render(
      <SectionAccordion
        {...baseProps}
        instances={[instance as never]}
        onAddInstance={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    // InstanceCard's remove (Trash2) is the only destructive-styled button.
    expect(document.querySelector('button.text-destructive')).toBeNull();
  });

  it('positive control: renders the remove button when onRemoveInstance is provided', () => {
    render(
      <SectionAccordion
        {...baseProps}
        instances={[instance as never]}
        onAddInstance={vi.fn()}
        onRemoveInstance={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
    expect(document.querySelector('button.text-destructive')).not.toBeNull();
  });
});
