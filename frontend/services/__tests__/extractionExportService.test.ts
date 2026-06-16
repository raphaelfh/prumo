import { describe, expect, it, vi, beforeEach } from 'vitest';

// `vi.hoisted` so the mock fn is defined alongside the hoisted `vi.mock`
// factory (vitest v4 enforces the temporal-dead-zone on a plain top-level
// `const` referenced from the hoisted factory).
const { apiBlobClient } = vi.hoisted(() => ({ apiBlobClient: vi.fn() }));
vi.mock('@/integrations/api/client', () => ({ apiBlobClient }));

import { startExport } from '@/services/extractionExportService';
import type { ExtractionExportRequest } from '@/types/extraction-export';

const req: ExtractionExportRequest = {
  mode: 'consensus',
  article_scope: 'current_list',
  include_ai_metadata: false,
  anonymize_reviewer_names: false,
} as ExtractionExportRequest;

describe('extractionExportService.startExport', () => {
  beforeEach(() => apiBlobClient.mockReset());

  it('maps a sync blob result to {kind:"sync"}', async () => {
    apiBlobClient.mockResolvedValue({ kind: 'sync', blob: new Blob(['x']), filename: 'e.xlsx' });
    const out = await startExport('proj-1', req);
    expect(apiBlobClient).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/extraction-export',
      expect.objectContaining({ method: 'POST', body: req }),
      'extraction_export.xlsx',
    );
    expect(out).toEqual({ kind: 'sync', blob: expect.any(Blob), filename: 'e.xlsx' });
  });

  it('maps an async result to {kind:"async"}', async () => {
    apiBlobClient.mockResolvedValue({ kind: 'async', job_id: 'job-9' });
    const out = await startExport('proj-1', req);
    expect(out).toEqual({ kind: 'async', job_id: 'job-9' });
  });

  it('forwards the AbortSignal', async () => {
    apiBlobClient.mockResolvedValue({ kind: 'async', job_id: 'j' });
    const ctrl = new AbortController();
    await startExport('proj-1', req, ctrl.signal);
    expect(apiBlobClient).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: ctrl.signal }),
      expect.any(String),
    );
  });
});
