import { describe, expect, it } from 'vitest';
import { t } from '@/lib/copy';

describe('runs copy namespace', () => {
  it('resolves shared run-header keys', () => {
    expect(t('runs', 'revision')).toBe('Revision');
    expect(t('runs', 'stageReview')).toBe('Review');
    expect(t('runs', 'reconcile')).toBe('Reconcile');
  });
});
