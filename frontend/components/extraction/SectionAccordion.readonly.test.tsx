import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { SectionAccordion } from '@/components/extraction/SectionAccordion';
import { RunEditabilityProvider } from '@/components/runs/RunEditabilityContext';

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
  sort_order: 0, is_required: true, created_at: '',
};

const instance = {
  id: 'i1',
  entity_type_id: 'et1',
  article_id: 'a',
  template_id: 't',
  label: null,
  metadata: {},
  created_at: '',
};

function renderReadOnly(ui: React.ReactElement) {
  return render(
    <RunEditabilityProvider stage="finalized">{ui}</RunEditabilityProvider>,
    { wrapper: Wrapper },
  );
}

describe('SectionAccordion under a read-only run', () => {
  it('hides the section AI-extract button and the empty-state add-instance button', () => {
    renderReadOnly(
      <SectionAccordion
        entityType={entityType}
        instances={[]}
        fields={[]}
        values={{}}
        onValueChange={vi.fn()}
        onAddInstance={vi.fn()}
        projectId="p" articleId="a" templateId="t"
      />,
    );
    expect(screen.queryByTestId('section-ai-extract-et1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sectionAddInstance/ })).not.toBeInTheDocument();
  });

  it('hides InstanceCard remove and the below-cards add-instance button', () => {
    // One instance so InstanceCard actually mounts and its gates execute.
    renderReadOnly(
      <SectionAccordion
        entityType={entityType}
        instances={[instance as never]}
        fields={[]}
        values={{}}
        onValueChange={vi.fn()}
        onAddInstance={vi.fn()}
        onRemoveInstance={vi.fn()}
        projectId="p" articleId="a" templateId="t"
      />,
    );
    expect(screen.queryByRole('button', { name: /addInstanceLabel/ })).not.toBeInTheDocument();
    // InstanceCard's remove (Trash2) is the only destructive-styled button.
    expect(document.querySelector('button.text-destructive')).toBeNull();
  });

  it('positive control: editable render shows extract + add-instance affordances', () => {
    render(
      <SectionAccordion
        entityType={entityType}
        instances={[]}
        fields={[]}
        values={{}}
        onValueChange={vi.fn()}
        onAddInstance={vi.fn()}
        projectId="p" articleId="a" templateId="t"
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId('section-ai-extract-et1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sectionAddInstance/ })).toBeInTheDocument();
  });
});
