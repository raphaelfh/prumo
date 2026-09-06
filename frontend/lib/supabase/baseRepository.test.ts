/**
 * `deleteOne` — the contract that a delete which removed nothing is a failure.
 *
 * Under RLS a DELETE matching zero visible rows is NOT an error. Postgres did
 * not fail; it matched nothing, and PostgREST answers success. A helper that
 * checks only `error` therefore cannot tell "denied" from "done", and every
 * caller reports success over an untouched row.
 *
 * This shipped: `extraction_instances_delete` is
 * `USING is_project_manager(project_id, auth.uid())`, and a reviewer clicking
 * the run form's trash icon got a green "removed" toast while the entry stayed
 * put. PR #831 hid that control from non-managers, but hiding a control is a
 * UI gate — it does not make the write honest for a stale tab, a role changed
 * mid-session, or the next caller.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

const h = vi.hoisted(() => ({
  response: {data: [] as unknown[] | null, error: null as unknown},
  eq: vi.fn(),
  select: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      delete: () => ({
        eq: (...args: unknown[]) => {
          h.eq(...args);
          return {
            select: (...sel: unknown[]) => {
              h.select(...sel);
              return Promise.resolve(h.response);
            },
          };
        },
      }),
    }),
  },
}));

import {deleteOne, SupabaseRepositoryError} from './baseRepository';

beforeEach(() => {
  h.eq.mockClear();
  h.select.mockClear();
  h.response = {data: [{id: 'i1'}], error: null};
});

describe('deleteOne — a delete that removed nothing', () => {
  it('rejects when RLS filtered the row away, instead of returning cleanly', async () => {
    h.response = {data: [], error: null};

    await expect(deleteOne('extraction_instances', 'i1', 'removeInstance')).rejects.toThrow(
      SupabaseRepositoryError,
    );
  });

  it('does not say WHICH of "missing" or "forbidden" it was', async () => {
    // Answering them differently turns the helper into an existence oracle for
    // rows the caller may not see — the same reason `owned_article` answers
    // both identically on the backend.
    h.response = {data: [], error: null};

    await expect(deleteOne('extraction_instances', 'i1', 'removeInstance')).rejects.toThrow(
      /does not exist, or row-level security/i,
    );
  });

  it('resolves when a row really was deleted', async () => {
    // Positive control: without this, the rejection above would still pass if
    // `deleteOne` threw unconditionally.
    h.response = {data: [{id: 'i1'}], error: null};

    await expect(deleteOne('extraction_instances', 'i1', 'removeInstance')).resolves.toBeUndefined();
  });

  it('asks for the deleted row back, filtered by id', async () => {
    // Structural, and the point of the fix: `.select()` is what makes the
    // outcome observable at all. Deleting it puts the silent success back
    // while every behavioural test above still passes on the mock.
    await deleteOne('extraction_instances', 'i1', 'removeInstance');

    expect(h.eq).toHaveBeenCalledWith('id', 'i1');
    expect(h.select).toHaveBeenCalled();
  });

  it('still surfaces a real PostgREST error', async () => {
    h.response = {data: null, error: {message: 'permission denied', code: '42501'}};

    await expect(deleteOne('extraction_instances', 'i1', 'removeInstance')).rejects.toThrow(
      /permission denied/,
    );
  });
});
