/**
 * Shared fixtures for the TemplateConfigDiffSheet test files: the wire-row
 * builders, the one-row-per-tier diff and the bare sheet render. Each test
 * file still declares its own `vi.mock`s (they hoist per file).
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen} from '@testing-library/react';
import type {ReactNode} from 'react';
import {vi} from 'vitest';

import {TemplateConfigDiffSheet} from '@/components/extraction/template-config/TemplateConfigDiffSheet';
import type {components} from '@/types/api/schema';

export type Tier = 'additive' | 'cosmetic' | 'semantic' | 'destructive';
export type Variant = components['schemas']['ChangeVariant'];
type OpaqueState = components['schemas']['OpaqueValueState'];

export interface RowSeed {
  id: string;
  variant: string;
  tier: Tier;
  label_path?: string[];
  attribute?: string | null;
  before?: string | boolean | null;
  after?: string | boolean | null;
  /** Set INSTEAD of `before`/`after` when the value is opaque (D3). */
  before_opaque_state?: OpaqueState | null;
  after_opaque_state?: OpaqueState | null;
  reorder_count?: number | null;
  affects_recorded_data?: boolean;
  affects_ai?: boolean;
}

export function row(seed: RowSeed) {
  return {
    label_path: ['Section A', 'Field X'],
    attribute: null,
    before: null,
    after: null,
    before_opaque_state: null,
    after_opaque_state: null,
    reorder_count: null,
    affects_recorded_data: false,
    affects_ai: false,
    ...seed,
  };
}

export function diffOk(rows: RowSeed[], fingerprint = 'fp-1') {
  const changes: Record<Tier, ReturnType<typeof row>[]> = {
    additive: [],
    cosmetic: [],
    semantic: [],
    destructive: [],
  };
  for (const seed of rows) changes[seed.tier].push(row(seed));
  return {
    ok: true,
    data: {
      project_template_id: 't1',
      status: 'available',
      changes,
      fingerprint,
    },
  };
}

/** One row per tier, each with a distinguishable label path. */
export const ONE_PER_TIER: RowSeed[] = [
  {
    id: 'a1',
    variant: 'field_added',
    tier: 'additive',
    label_path: ['Section A', 'Brand new field'],
  },
  {
    id: 'c1',
    variant: 'entity_type_modified',
    tier: 'cosmetic',
    label_path: ['Renamed section'],
    attribute: 'label',
    before: 'Old name',
    after: 'New name',
  },
  {
    id: 's1',
    variant: 'field_modified',
    tier: 'semantic',
    label_path: ['Section A', 'Newly required field'],
    attribute: 'is_required',
    before: false,
    after: true,
  },
  {
    id: 'd1',
    variant: 'field_removed',
    tier: 'destructive',
    label_path: ['Section A', 'Deleted field'],
  },
];

export function renderSheet() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <TemplateConfigDiffSheet projectId="p1" templateId="t1" onClose={vi.fn()} />,
    {wrapper},
  );
}

export const group = async (tier: Tier) =>
  screen.findByTestId(`template-diff-group-${tier}`);
