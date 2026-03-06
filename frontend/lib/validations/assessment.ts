import {z} from 'zod';

/**
 * Validation schemas for assessments using Zod
 * Keeps frontend and backend consistent
 */

export const AssessmentResponseSchema = z.object({
    level: z.string().min(1, 'Level is required'),
  comment: z.string().optional(),
});

// Schema for full assessment
export const AssessmentSchema = z.object({
    project_id: z.string().uuid('Invalid project ID'),
    article_id: z.string().uuid('Invalid article ID'),
    user_id: z.string().uuid('Invalid user ID'),
    instrument_id: z.string().uuid('Invalid instrument ID'),
  tool_type: z.enum(['manual', 'ai_assisted', 'ai_automatic']),
  responses: z.record(z.string(), AssessmentResponseSchema),
  status: z.enum(['in_progress', 'submitted', 'locked', 'archived']),
  completion_percentage: z.number().min(0).max(100),
});

// Schema for AI configuration
export const AIConfigurationSchema = z.object({
    project_id: z.string().uuid('Invalid project ID'),
    instrument_id: z.string().uuid('Invalid instrument ID').optional(),
    model_name: z.string().min(1, 'Model name is required'),
  temperature: z.number().min(0).max(2),
  max_tokens: z.number().min(1).max(4096),
  system_instruction: z.string().optional(),
  is_active: z.boolean(),
});

// Schema for AI prompt configuration
export const AIPromptConfigSchema = z.object({
    assessment_item_id: z.string().uuid('Invalid assessment item ID'),
    system_prompt: z.string().min(1, 'System prompt is required'),
    user_prompt_template: z.string().min(1, 'User prompt template is required'),
});

// Schema for AI assessment result
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

// Schema for file upload
export const FileUploadSchema = z.object({
    article_id: z.string().uuid('Invalid article ID'),
  file_type: z.enum(['MAIN_PDF', 'SUPPLEMENTARY_PDF', 'DATA_FILE', 'FIGURE', 'TABLE']),
    original_filename: z.string().min(1, 'File name is required'),
    bytes: z.number().min(1, 'File size must be greater than 0'),
});

// Schema for global AI configuration
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

// Schemas for Edge Function input validation
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

// TypeScript types derived from schemas
export type AssessmentResponse = z.infer<typeof AssessmentResponseSchema>;
export type Assessment = z.infer<typeof AssessmentSchema>;
export type AIConfiguration = z.infer<typeof AIConfigurationSchema>;
export type AIPromptConfig = z.infer<typeof AIPromptConfigSchema>;
export type AIAssessmentResult = z.infer<typeof AIAssessmentResultSchema>;
export type FileUpload = z.infer<typeof FileUploadSchema>;
export type AIGlobalConfig = z.infer<typeof AIGlobalConfigSchema>;
export type EdgeFunctionAIAssessment = z.infer<typeof EdgeFunctionAIAssessmentSchema>;

// Utility functions for validation
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

// Safe validation helpers (do not throw)
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
