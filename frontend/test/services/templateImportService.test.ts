/**
 * Issues #26 / #78 regression: `createInitialInstances` used to detect
 * duplicate-row errors by matching `insertError.message.includes('duplicate')`,
 * which (a) breaks under non-English `lc_messages` locales and (b) can
 * swallow unrelated errors whose message coincidentally contains "duplicate".
 *
 * The fix tests `insertError.code === '23505'` (PostgreSQL SQLSTATE for
 * `unique_violation`), which is locale-independent and unambiguous.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => {
  const mock = { from: vi.fn(), auth: { getUser: vi.fn() } };
  return { supabase: mock };
});
vi.mock('@/integrations/api/client', () => ({
  apiClient: vi.fn(),
}));
vi.mock('@/lib/copy', () => ({
  t: (..._: unknown[]) => 'mocked-copy',
}));

import { supabase } from '@/integrations/supabase/client';
import { createInitialInstances } from '@/services/templateImportService';

function selectChain(rows: unknown[], error: unknown = null) {
  // Models the .from(...).select(...).eq(...).eq(...).is(...) sequence
  // used to load entity types.
  const result = { data: rows, error };
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => Promise.resolve(result)),
  };
  return chain;
}

function insertChain(error: unknown) {
  return {
    insert: vi.fn(() => Promise.resolve({ error })),
  };
}

describe('createInitialInstances duplicate detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats SQLSTATE 23505 as success even when the message is non-English', async () => {
    const calls: Array<{ table: string }> = [];
    (supabase as any).from = vi.fn((table: string) => {
      calls.push({ table });
      if (table === 'extraction_entity_types') {
        return selectChain([{ id: 'et-1', label: 'Study' }]);
      }
      // extraction_instances → duplicate insert returns Portuguese message
      // but the canonical PG SQLSTATE 23505.
      return insertChain({
        code: '23505',
        message: 'valor de chave duplicado viola restrição de unicidade',
      });
    });

    const res = await createInitialInstances('proj-1', 'art-1', 'tpl-1', 'user-1');
    expect(res).toEqual({ success: true });
  });

  it('re-throws non-23505 errors even when the message says "duplicate"', async () => {
    (supabase as any).from = vi.fn((table: string) => {
      if (table === 'extraction_entity_types') {
        return selectChain([{ id: 'et-1', label: 'Study' }]);
      }
      // Unrelated trigger error whose message happens to contain
      // "duplicate" — must NOT be swallowed.
      return insertChain({
        code: 'P0001',
        message: 'Cannot duplicate this record: template is locked',
      });
    });

    const res = await createInitialInstances('proj-1', 'art-1', 'tpl-1', 'user-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/locked/);
  });

  it('succeeds on a clean insert', async () => {
    (supabase as any).from = vi.fn((table: string) => {
      if (table === 'extraction_entity_types') {
        return selectChain([{ id: 'et-1', label: 'Study' }]);
      }
      return insertChain(null);
    });

    const res = await createInitialInstances('proj-1', 'art-1', 'tpl-1', 'user-1');
    expect(res).toEqual({ success: true });
  });
});
