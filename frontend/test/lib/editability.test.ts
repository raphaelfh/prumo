import { describe, expect, it } from 'vitest';

import { isRunEditable } from '@/lib/runs/editability';

describe('isRunEditable', () => {
  it('is true only for the extract stage', () => {
    expect(isRunEditable('extract')).toBe(true);
    for (const stage of ['finalized', 'consensus', 'pending', 'cancelled', null, undefined]) {
      expect(isRunEditable(stage)).toBe(false);
    }
  });
});
