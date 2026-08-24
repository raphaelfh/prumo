/**
 * The entry-key selector (0059).
 *
 * A repeating section needs an identity, or an AI re-run cannot tell a new
 * entry from one it already extracted. The backend refuses rather than
 * duplicating, so this control is what makes that refusal satisfiable —
 * without it a hand-built repeating section is a dead end.
 */

import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {SectionInspectorForm} from './TemplateInspectorSectionPane';
import type {GridField, GridSection} from './templateTree';

const mutateAsync = vi.fn().mockResolvedValue({});

vi.mock('@/hooks/extraction/useUpdateTemplateSection', () => ({
  useUpdateTemplateSection: () => ({mutateAsync, isPending: false}),
}));
vi.mock('@/hooks/extraction/useUpdateTemplateField', () => ({
  useUpdateTemplateField: () => ({mutateAsync, isPending: false}),
}));

function field(id: string, label: string, isEntityKey = false): GridField {
  return {
    id,
    entityTypeId: 'et-1',
    sortOrder: 0,
    label,
    key: label.toLowerCase(),
    fieldType: 'text',
    isRequired: false,
    isEntityKey,
    description: null,
    aiInstruction: null,
    hasAiInstruction: false,
  } as GridField;
}

function section(overrides: Partial<GridSection> = {}): GridSection {
  return {
    id: 'sec-1',
    label: 'Numeric Performance',
    kind: 'groupChild',
    cardinality: 'many',
    entryNoun: 'model',
    fields: [field('f-1', 'Validation type'), field('f-2', 'AUC')],
    children: [],
    totalFieldCount: 2,
    description: null,
    ...overrides,
  } as GridSection;
}

function renderPane(s: GridSection) {
  return render(
    <SectionInspectorForm
      projectId="p-1"
      templateId="t-1"
      section={s}
      parentGroupLabel="Prediction Models"
    />,
  );
}

describe('entry-key selector', () => {
  it('offers the section fields as the entry key when the section repeats', () => {
    renderPane(section());
    const select = screen.getByLabelText('Entry key') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContain('Validation type');
    expect(options).toContain('AUC');
  });

  it('warns that AI re-runs are blocked while no key is declared', () => {
    renderPane(section());
    const select = screen.getByLabelText('Entry key') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(screen.getByText(/AI re-runs are blocked/i)).toBeInTheDocument();
  });

  it('preselects the field that already holds the key', () => {
    renderPane(
      section({fields: [field('f-1', 'Validation type', true), field('f-2', 'AUC')]}),
    );
    expect((screen.getByLabelText('Entry key') as HTMLSelectElement).value).toBe('f-1');
  });

  it('is absent on a section that does not repeat', () => {
    renderPane(section({cardinality: 'one'}));
    expect(screen.queryByLabelText('Entry key')).not.toBeInTheDocument();
  });
});
