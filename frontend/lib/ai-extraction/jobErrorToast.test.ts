import {describe, expect, it, vi} from 'vitest';

// `t` is mocked to echo the copy key so assertions read the key directly.
vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import {jobErrorToast} from '@/lib/ai-extraction/jobErrorToast';

describe('jobErrorToast', () => {
  it('maps MISSING_API_KEY to the auth title + the backend message', () => {
    expect(jobErrorToast('MISSING_API_KEY', 'No OpenAI API key available.')).toEqual({
      title: 'sectionExtractionErrorAuth',
      description: 'No OpenAI API key available.',
      duration: 8000,
    });
  });

  it('maps PDF_NOT_FOUND to the generic error title + the backend message', () => {
    expect(jobErrorToast('PDF_NOT_FOUND', 'PDF not found. Upload a PDF first.')).toEqual({
      title: 'sectionExtractionErrorTitle',
      description: 'PDF not found. Upload a PDF first.',
      duration: 8000,
    });
  });

  it('returns null for the generic code so the caller uses its own fallback', () => {
    expect(jobErrorToast('EXTRACTION_FAILED', 'something broke')).toBeNull();
  });

  it('returns null for a missing or unknown code', () => {
    expect(jobErrorToast(null, 'x')).toBeNull();
    expect(jobErrorToast(undefined, 'x')).toBeNull();
  });
});
