import {partialMatchKey, QueryClient} from '@tanstack/react-query';
import {describe, expect, it} from 'vitest';

import {invalidateScreening, screeningKeys} from '@/lib/query-keys/screening';

describe('screeningKeys.records', () => {
  it('is the phase-less family without a trailing undefined', () => {
    const key = screeningKeys.records('p');
    expect(key).toEqual(['screening', 'project', 'p', 'records']);
    expect(key).toHaveLength(4);
  });

  it('appends the phase', () => {
    expect(screeningKeys.records('p', 'title_abstract')).toEqual([
      'screening',
      'project',
      'p',
      'records',
      'title_abstract',
    ]);
  });

  it('nests a phase key under the phase-less family', () => {
    expect(partialMatchKey(screeningKeys.records('p', 'title_abstract'), screeningKeys.records('p'))).toBe(true);
  });
});

describe('screeningKeys.duplicates', () => {
  it('sits under the project prefix', () => {
    expect(screeningKeys.duplicates('p')).toEqual(['screening', 'project', 'p', 'duplicates']);
    expect(partialMatchKey(screeningKeys.duplicates('p'), screeningKeys.project('p'))).toBe(true);
  });
});

describe('invalidateScreening', () => {
  it('invalidates a cached records query of the project', async () => {
    const client = new QueryClient();
    const key = screeningKeys.records('p', 'title_abstract');
    client.setQueryData(key, {rows: []});
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);

    await invalidateScreening(client, 'p');

    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it('leaves another project untouched', async () => {
    const client = new QueryClient();
    const other = screeningKeys.records('q', 'title_abstract');
    client.setQueryData(other, {rows: []});

    await invalidateScreening(client, 'p');

    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  });
});
