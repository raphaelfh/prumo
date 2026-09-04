import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('sonner', () => ({
  toast: {error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn()},
}));
vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import {toast} from 'sonner';

import {showExtractionErrorToast} from '@/hooks/extraction/helpers/showExtractionErrorToast';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('showExtractionErrorToast', () => {
  it('fires the mapped toast and reports it for a classified code', () => {
    const message = "The repeating section 'Final predictors' declares no entry key.";
    expect(showExtractionErrorToast('MISSING_ENTITY_KEY', message)).toBe(true);
    expect(toast.error).toHaveBeenCalledWith('sectionExtractionErrorNoEntryKey', {
      description: message,
      duration: 8000,
    });
  });

  it('fires nothing for the generic code so the caller falls back', () => {
    expect(showExtractionErrorToast('EXTRACTION_FAILED', 'boom')).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('fires nothing for a missing code', () => {
    expect(showExtractionErrorToast(null, 'boom')).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
