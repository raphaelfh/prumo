import { z } from 'zod';

/**
 * Esquemas de validação para avaliações usando Zod
 * Garante consistência entre frontend e backend
 */

// Esquema para resposta de avaliação
export const AssessmentResponseSchema = z.object({
  level: z.string().min(1, 'Nível é obrigatório'),
  comment: z.string().optional(),
});

// Esquema para avaliação completa
export const AssessmentSchema = z.object({
  project_id: z.string().uuid('ID do projeto inválido'),
  article_id: z.string().uuid('ID do artigo inválido'),
  user_id: z.string().uuid('ID do usuário inválido'),
  instrument_id: z.string().uuid('ID do instrumento inválido'),
  tool_type: z.enum(['manual', 'ai_assisted', 'ai_automatic']),
  responses: z.record(z.string(), AssessmentResponseSchema),
  status: z.enum(['in_progress', 'submitted', 'locked', 'archived']),
  completion_percentage: z.number().min(0).max(100),
});

// Esquema para configuração de IA
export const AIConfigurationSchema = z.object({
  project_id: z.string().uuid('ID do projeto inválido'),
  instrument_id: z.string().uuid('ID do instrumento inválido').optional(),
  model_name: z.string().min(1, 'Nome do modelo é obrigatório'),
  temperature: z.number().min(0).max(2),
  max_tokens: z.number().min(1).max(4096),
  system_instruction: z.string().optional(),
  is_active: z.boolean(),
});

// Esquema para configuração de prompt de IA
export const AIPromptConfigSchema = z.object({
  assessment_item_id: z.string().uuid('ID do item de avaliação inválido'),
  system_prompt: z.string().min(1, 'Prompt do sistema é obrigatório'),
  user_prompt_template: z.string().min(1, 'Template do prompt do usuário é obrigatório'),
});

// Esquema para resultado de avaliação de IA
export const AIAssessmentResultSchema = z.object({
  selected_level: z.string(),
  confidence_score: z.number().min(0).max(1),
  justification: z.string(),
  evidence_passages: z.array(z.object({
    text: z.string(),
    page_number: z.number(),
    relevance_score: z.number().min(0).max(1),
  })),
});

// Esquema para upload de arquivo
export const FileUploadSchema = z.object({
  article_id: z.string().uuid('ID do artigo inválido'),
  file_type: z.enum(['MAIN_PDF', 'SUPPLEMENTARY_PDF', 'DATA_FILE', 'FIGURE', 'TABLE']),
  original_filename: z.string().min(1, 'Nome do arquivo é obrigatório'),
  bytes: z.number().min(1, 'Tamanho do arquivo deve ser maior que 0'),
});

// Esquema para configuração global de IA
export const AIGlobalConfigSchema = z.object({
  parallelMode: z.boolean(),
  concurrency: z.number().min(1).max(10),
  delayBetweenBatches: z.number().min(0).max(10000),
  model_name: z.string().min(1),
  temperature: z.number().min(0).max(2),
  max_tokens: z.number().min(1).max(4096),
  system_instruction: z.string().optional(),
  userPromptTemplate: z.string().min(1),
});

// Esquemas para validação de entrada de Edge Functions
export const EdgeFunctionAIAssessmentSchema = z.object({
  projectId: z.string().uuid(),
  articleId: z.string().uuid(),
  assessmentItemId: z.string().uuid(),
  instrumentId: z.string().uuid(),
  pdf_storage_key: z.string().optional(),
  pdf_base64: z.string().optional(),
  pdf_filename: z.string().optional(),
  pdf_file_id: z.string().optional(),
  force_file_search: z.boolean().optional(),
});

// Tipos TypeScript derivados dos esquemas
export type AssessmentResponse = z.infer<typeof AssessmentResponseSchema>;
export type Assessment = z.infer<typeof AssessmentSchema>;
export type AIConfiguration = z.infer<typeof AIConfigurationSchema>;
export type AIPromptConfig = z.infer<typeof AIPromptConfigSchema>;
export type AIAssessmentResult = z.infer<typeof AIAssessmentResultSchema>;
export type FileUpload = z.infer<typeof FileUploadSchema>;
export type AIGlobalConfig = z.infer<typeof AIGlobalConfigSchema>;
export type EdgeFunctionAIAssessment = z.infer<typeof EdgeFunctionAIAssessmentSchema>;

// Funções utilitárias para validação
export const validateAssessmentResponse = (data: unknown): AssessmentResponse => {
  return AssessmentResponseSchema.parse(data);
};

export const validateAssessment = (data: unknown): Assessment => {
  return AssessmentSchema.parse(data);
};

export const validateAIConfiguration = (data: unknown): AIConfiguration => {
  return AIConfigurationSchema.parse(data);
};

export const validateAIPromptConfig = (data: unknown): AIPromptConfig => {
  return AIPromptConfigSchema.parse(data);
};

export const validateAIAssessmentResult = (data: unknown): AIAssessmentResult => {
  return AIAssessmentResultSchema.parse(data);
};

export const validateFileUpload = (data: unknown): FileUpload => {
  return FileUploadSchema.parse(data);
};

export const validateAIGlobalConfig = (data: unknown): AIGlobalConfig => {
  return AIGlobalConfigSchema.parse(data);
};

export const validateEdgeFunctionInput = (data: unknown): EdgeFunctionAIAssessment => {
  return EdgeFunctionAIAssessmentSchema.parse(data);
};

// Funções para validação segura (não lançam exceção)
export const safeValidate = <T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: z.ZodError } => {
  try {
    const result = schema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error };
    }
    throw error;
  }
};
