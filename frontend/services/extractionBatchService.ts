/**
 * AI batch runs API client (spec 2026-09-15 §7). The wire is snake_case and
 * the payload types come from the generated schema.
 */
import {apiClient} from '@/integrations/api/client';
import type {
  CreateExtractionBatchRequest,
  ExtractionBatchDetail,
  ExtractionBatchSummary,
} from '@/types/extraction-batch';

const BASE = '/api/v1/extraction/batches';

export async function startExtractionBatch(
  request: CreateExtractionBatchRequest,
): Promise<ExtractionBatchDetail> {
  return apiClient<ExtractionBatchDetail>(BASE, {method: 'POST', body: request});
}

export async function listExtractionBatches(params: {
  projectId?: string;
  active?: boolean;
}): Promise<ExtractionBatchSummary[]> {
  const search = new URLSearchParams();
  if (params.projectId) search.set('project_id', params.projectId);
  if (params.active) search.set('active', 'true');
  const query = search.toString();
  return apiClient<ExtractionBatchSummary[]>(query ? `${BASE}?${query}` : BASE);
}

export async function getExtractionBatch(batchId: string): Promise<ExtractionBatchDetail> {
  return apiClient<ExtractionBatchDetail>(`${BASE}/${encodeURIComponent(batchId)}`);
}

export async function cancelExtractionBatch(batchId: string): Promise<ExtractionBatchDetail> {
  return apiClient<ExtractionBatchDetail>(`${BASE}/${encodeURIComponent(batchId)}/cancel`, {
    method: 'POST',
  });
}

export async function resumeExtractionBatch(batchId: string): Promise<ExtractionBatchDetail> {
  return apiClient<ExtractionBatchDetail>(`${BASE}/${encodeURIComponent(batchId)}/resume`, {
    method: 'POST',
  });
}
