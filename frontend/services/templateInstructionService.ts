/**
 * Template general AI instruction (spec Phase A). Typed endpoint pair —
 * the PUT updates the column AND republishes server-side in one
 * transaction, so no separate republish call is needed here.
 *
 * Throwing style (like hitlConfigService): these functions feed TanStack
 * queryFn/mutationFn directly, which own the error handling.
 */
import { apiClient } from '@/integrations/api';
import type { components } from '@/types/api/schema';

export type TemplateInstructionRead =
  components['schemas']['TemplateInstructionRead'];
export type UpdateTemplateInstructionResponse =
  components['schemas']['UpdateTemplateInstructionResponse'];

export function getTemplateInstruction(
  projectId: string,
  templateId: string,
): Promise<TemplateInstructionRead> {
  return apiClient<TemplateInstructionRead>(
    `/api/v1/projects/${projectId}/templates/${templateId}/llm-instruction`,
  );
}

export function updateTemplateInstruction(
  projectId: string,
  templateId: string,
  llmTemplateInstruction: string | null,
): Promise<UpdateTemplateInstructionResponse> {
  const body: components['schemas']['UpdateTemplateInstructionRequest'] = {
    llm_template_instruction: llmTemplateInstruction,
  };
  return apiClient<UpdateTemplateInstructionResponse>(
    `/api/v1/projects/${projectId}/templates/${templateId}/llm-instruction`,
    { method: 'PUT', body },
  );
}
