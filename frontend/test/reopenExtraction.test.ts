import { describe, expect, it } from 'vitest';

import { deriveCanReopenExtraction } from '@/lib/extraction/reopenExtraction';

describe('deriveCanReopenExtraction', () => {
  it('is true only for an arbitrator in the consensus stage', () => {
    expect(deriveCanReopenExtraction(true, 'consensus')).toBe(true);
  });

  it('is false in every non-consensus stage, even for an arbitrator', () => {
    for (const stage of ['pending', 'extract', 'finalized', 'cancelled', null] as const) {
      expect(deriveCanReopenExtraction(true, stage)).toBe(false);
    }
  });

  it('is false for a non-arbitrator, even in consensus', () => {
    expect(deriveCanReopenExtraction(false, 'consensus')).toBe(false);
  });
});
