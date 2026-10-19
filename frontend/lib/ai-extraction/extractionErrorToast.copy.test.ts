import {describe, expect, it} from 'vitest';

import {extractionErrorToast} from '@/lib/ai-extraction/extractionErrorToast';

// Real copy (no `t` mock): the toast title must add information, never repeat
// the backend message the toast already shows as its description.
describe('extractionErrorToast real copy', () => {
  it('gives RUN_FINALIZED a short title distinct from the backend message', () => {
    const message = 'This article is finalized. Reopen it to run AI again.';
    const toast = extractionErrorToast('RUN_FINALIZED', message);

    expect(toast?.title).toBe('Run already finalized');
    expect(toast?.description).toBe(message);
  });
});
