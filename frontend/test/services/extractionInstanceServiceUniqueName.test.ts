/**
 * Issue #10 regression: `ensureUniqueName` used to bake a regex
 * replacement into the label, so attempts 3–10 always re-checked the
 * *original* label (already known to be taken) and the loop fell
 * through to the timestamp fallback. The fix strips any trailing
 * "(n)" and appends the new attempt number unconditionally, producing
 * a clean sequence: "Study", "Study (2)", "Study (3)", ...
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// We mock the supabase client so we can script how many times "label
// is taken" before returning a free slot.
vi.mock('@/integrations/supabase/client', () => {
  const mock = { from: vi.fn() };
  return { supabase: mock };
});

import { supabase } from '@/integrations/supabase/client';
import { ExtractionInstanceService } from '@/services/extractionInstanceService';

interface MockChain {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  limit: (n: number) => Promise<{ data: unknown[] | null; error: null }>;
}

/**
 * Build a chain that records each `label` filter the service tested
 * and returns "taken" for any label in `takenLabels`, "free" otherwise.
 */
function buildChain(takenLabels: Set<string>): { from: ReturnType<typeof vi.fn>; checked: string[] } {
  const checked: string[] = [];
  const from = vi.fn(() => {
    let currentLabel = '';
    const chain: MockChain = {
      select: vi.fn(() => chain) as any,
      eq: vi.fn((col: string, value: unknown) => {
        if (col === 'label') currentLabel = String(value);
        return chain;
      }) as any,
      limit: async () => {
        checked.push(currentLabel);
        if (takenLabels.has(currentLabel)) {
          return { data: [{ id: 'existing' }], error: null };
        }
        return { data: [], error: null };
      },
    };
    return chain;
  });
  return { from, checked };
}

describe('ExtractionInstanceService.ensureUniqueName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('produces clean sequential "(n)" suffixes when the base + "(2)" are taken', async () => {
    const { from, checked } = buildChain(new Set(['Study', 'Study (2)']));
    (supabase as any).from = from;

    const svc = new ExtractionInstanceService();
    // ensureUniqueName is private; bracket access keeps strict TS happy.
    const label = await (svc as any).ensureUniqueName('Study', 'art-1', 'et-1');

    expect(label).toBe('Study (3)');
    // Loop must have checked the original, then "(2)", then "(3)" — never
    // the original again (which is the bug the issue captures).
    expect(checked).toEqual(['Study', 'Study (2)', 'Study (3)']);
  });

  it('returns the base label unchanged when it is free on the first try', async () => {
    const { from } = buildChain(new Set());
    (supabase as any).from = from;

    const svc = new ExtractionInstanceService();
    const label = await (svc as any).ensureUniqueName('Study', 'art-1', 'et-1');

    expect(label).toBe('Study');
  });

  it('strips a pre-existing "(n)" suffix before incrementing', async () => {
    // Caller passed in a label that already ends in (5) — make sure we
    // don't end up doubling the suffix ("Study (5) (6)").
    const { from, checked } = buildChain(new Set(['Study (5)']));
    (supabase as any).from = from;

    const svc = new ExtractionInstanceService();
    const label = await (svc as any).ensureUniqueName('Study (5)', 'art-1', 'et-1');

    expect(label).toBe('Study (2)');
    expect(checked).toEqual(['Study (5)', 'Study (2)']);
  });
});
