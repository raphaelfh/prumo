/**
 * TypeScript types for the data extraction module
 *
 * This file defines all interfaces and types required for the
 * structured data extraction system.
 *
 * Includes Zod schemas for runtime validation.
 */

import {z} from 'zod';

// =================== ENUMS ===================

export type ExtractionFramework = 'CHARMS' | 'PICOS' | 'CUSTOM';
export type ExtractionFieldType = 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'boolean';
export type ExtractionCardinality = 'one' | 'many';
export type ExtractionSource = 'human' | 'ai' | 'rule';

/**
 * Extraction value type by field type
 * Ensures type safety instead of using `any`
 */
export type ExtractionValue = 
  | string      // text, select
  | number      // number
  | Date        // date
  | string[]    // multiselect
  | boolean     // boolean
    | null;       // unfilled values

// Values with "Other (specify)" support
export type SelectSingleValue = 
  | string
  | { selected: 'other'; other_text: string };

export type SelectMultiValue = 
  | string[]
  | { selected: string[]; other_texts: string[] };

// =================== TEMPLATES ===================

/**
 * Standardized global template (CHARMS, PICOS, PRISMA, etc.)
 * Maintained by admins, read-only for users
 */
export interface GlobalExtractionTemplate {
  id: string;
  name: string;
  description: string | null;
  framework: ExtractionFramework;
  version: string;
  is_global: boolean;
  schema: any;
  created_at: string;
  updated_at: string;
}

// Alias for compatibility (deprecated, use GlobalExtractionTemplate)
export type ExtractionTemplate = GlobalExtractionTemplate;

export interface ProjectExtractionTemplate {
  id: string;
  project_id: string;
  global_template_id: string | null;
  name: string;
  description: string | null;
  framework: ExtractionFramework;
  version: string;
  schema: any;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// =================== ENTIDADES E CAMPOS ===================

export interface ExtractionEntityType {
  id: string;
  template_id: string;
  name: string;
  label: string;
  description: string | null;
  parent_entity_type_id: string | null;
  cardinality: ExtractionCardinality;
  sort_order: number;
  is_required: boolean;
  created_at: string;
}

export interface ExtractionField {
  id: string;
  entity_type_id: string;
  name: string;
  label: string;
  description: string | null;
  field_type: ExtractionFieldType;
  is_required: boolean;
  validation_schema: any;
  allowed_values: string[] | null;
  unit: string | null;
    allowed_units: string[] | null; // Configurable alternative units for number fields
    llm_description: string | null; // Specific instruction for AI extraction
  sort_order: number;
  created_at: string;
    // "Other (specify)" support inline
  allow_other?: boolean;
  other_label?: string | null;
  other_placeholder?: string | null;
}

// =================== INSTANCES AND VALUES ===================

export interface ExtractionInstance {
  id: string;
  project_id: string;
  article_id: string;
  template_id: string;
  entity_type_id: string;
  parent_instance_id: string | null;
  label: string;
  sort_order: number;
  metadata: any;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ExtractedValue {
  id: string;
  project_id: string;
  article_id: string;
  instance_id: string;
  field_id: string;
  value: any;
  unit?: string | null;
  source: ExtractionSource;
  confidence_score: number | null;
  evidence: any[];
  reviewer_id: string | null;
  is_consensus: boolean;
  created_at: string;
  updated_at: string;
}

// =================== EVIDÊNCIAS ===================

export interface ExtractionEvidence {
  id: string;
  project_id: string;
  article_id: string;
  target_type: 'value' | 'instance';
  target_id: string;
  article_file_id: string | null;
  page_number: number | null;
  position: any;
  text_content: string | null;
  created_by: string;
  created_at: string;
}

// =================== IA E EXECUÇÕES ===================

/**
 * @deprecated Use ExtractionRunRaw from '@/types/ai-extraction' for DB data
 * Use ExtractionRun from '@/types/ai-extraction' for processed data
 *
 * Kept only for backward compatibility with legacy code.
 */
export type { ExtractionRunRaw as ExtractionRun } from '@/types/ai-extraction';

/**
 * @deprecated Use AISuggestionRaw from '@/types/ai-extraction' for DB data
 * Use AISuggestion from '@/types/ai-extraction' for processed data
 *
 * Kept only for backward compatibility with legacy code.
 */
export type { AISuggestionRaw as AISuggestion } from '@/types/ai-extraction';

// Re-export related types for convenience
export type { SuggestionStatus, ExtractionRunStatus, ExtractionRunStage } from '@/types/ai-extraction';

// =================== INSERT TYPES ===================

export interface ExtractionInstanceInsert {
  project_id: string;
  article_id: string;
  template_id: string;
  entity_type_id: string;
  parent_instance_id?: string;
  label: string;
  sort_order?: number;
  metadata?: any;
  created_by: string;
}

export interface ExtractedValueInsert {
  project_id: string;
  article_id: string;
  instance_id: string;
  field_id: string;
  value: any;
  unit?: string | null;
  source: ExtractionSource;
  confidence_score?: number;
  evidence?: any[];
  reviewer_id?: string;
  is_consensus?: boolean;
}

export interface ExtractionEvidenceInsert {
  project_id: string;
  article_id: string;
  target_type: 'value' | 'instance';
  target_id: string;
  article_file_id?: string;
  page_number?: number;
  position?: any;
  text_content?: string;
  created_by: string;
}

// =================== FORM TYPES ===================

export interface ExtractionFormData {
  [instanceId: string]: {
    [fieldId: string]: any;
  };
}

export interface ExtractionFormState {
  instances: ExtractionInstance[];
  values: ExtractedValue[];
  evidence: ExtractionEvidence[];
  suggestions: AISuggestion[];
  loading: boolean;
  saving: boolean;
  error: string | null;
}

// =================== UI TYPES ===================

export interface ExtractionTemplateOption {
  id: string;
  name: string;
  description: string;
  framework: ExtractionFramework;
  version: string;
}

export interface ExtractionEntityDisplay {
  entityType: ExtractionEntityType;
  fields: ExtractionField[];
  instances: ExtractionInstance[];
  values: ExtractedValue[];
}

export interface ExtractionFieldDisplay {
  field: ExtractionField;
  value: ExtractedValue | null;
  suggestions: AISuggestion[];
  evidence: ExtractionEvidence[];
}

// =================== EXPORT TYPES ===================

export interface ExtractionExportData {
  template: ProjectExtractionTemplate;
  instances: ExtractionInstance[];
  values: ExtractedValue[];
  evidence: ExtractionEvidence[];
  metadata: {
    exported_at: string;
    exported_by: string;
    article_count: number;
    instance_count: number;
    value_count: number;
  };
}

export interface ExtractionSummaryData {
  article_id: string;
  template_id: string;
  entity_type_id: string;
  entity_label: string;
  instance_count: number;
  completed_fields: number;
  total_fields: number;
  completion_percentage: number;
}

// =================== VALIDATION TYPES ===================

export interface ExtractionValidationError {
  field_id: string;
  field_name: string;
  error_type: 'required' | 'format' | 'range' | 'custom';
  message: string;
  value: any;
}

export interface ExtractionValidationResult {
  valid: boolean;
  errors: ExtractionValidationError[];
  warnings: ExtractionValidationError[];
}

// =================== ZOD SCHEMAS (Runtime validation) ===================

/**
 * Zod schema for extraction field validation
 * Used when creating or editing fields
 */
export const ExtractionFieldSchema = z.object({
  name: z.string()
      .regex(/^[a-z][a-z0-9_]*$/, 'Name must be in snake_case (e.g. field_example)')
      .min(2, 'Name must be at least 2 characters')
      .max(50, 'Name must be at most 50 characters'),
  
  label: z.string()
      .min(1, 'Label is required')
      .max(100, 'Label must be at most 100 characters'),
  
  description: z.string()
      .max(500, 'Description must be at most 500 characters')
    .optional()
    .nullable(),
  
  field_type: z.enum(['text', 'number', 'date', 'select', 'multiselect', 'boolean'], {
      errorMap: () => ({message: 'Invalid field type'}),
  }),
  
  is_required: z.boolean().default(false),
  
  unit: z.string()
      .max(50, 'Unit must be at most 50 characters')
    .optional()
    .nullable(),
  
  allowed_units: z.array(z.string().max(50))
      .min(1, 'Must have at least one alternative unit')
      .max(20, 'Maximum of 20 alternative units')
    .optional()
    .nullable()
    .refine(
      (units) => {
        if (!units) return true;
        const unique = new Set(units);
        return unique.size === units.length;
      },
        {message: 'Units cannot have duplicates'}
    ),
  
  llm_description: z.string()
      .max(1000, 'AI instruction must be at most 1000 characters')
    .optional()
    .nullable(),
  
  allowed_values: z.array(z.string())
      .min(1, 'Must have at least one allowed value')
      .max(100, 'Maximum of 100 allowed values')
    .optional()
    .nullable()
    .refine(
      (values) => {
        if (!values) return true;
        const unique = new Set(values);
        return unique.size === values.length;
      },
        {message: 'Allowed values cannot have duplicates'}
    ),

  // Suporte a "Outro (especificar)"
  allow_other: z.boolean().default(false).optional(),
  other_label: z.string()
      .max(100, '"Other" label must be at most 100 characters')
    .default('Outro (especificar)')
    .optional()
    .nullable(),
  other_placeholder: z.string()
      .max(200, 'Placeholder must be at most 200 characters')
    .optional()
    .nullable(),
  
  validation_schema: z.record(z.any())
    .optional()
    .nullable(),
  
  sort_order: z.number()
      .int('Order must be an integer')
      .min(0, 'Order must be greater than or equal to 0')
    .default(0),
});

/**
 * Inferred type from Zod schema
 */
export type ExtractionFieldInput = z.infer<typeof ExtractionFieldSchema>;

/**
 * Partial schema for update (all fields optional)
 */
export const ExtractionFieldUpdateSchema = ExtractionFieldSchema.partial();
export type ExtractionFieldUpdate = z.infer<typeof ExtractionFieldUpdateSchema>;

/**
 * Type for DB insert (adds entity_type_id)
 */
export interface ExtractionFieldInsert extends Omit<ExtractionFieldInput, 'sort_order'> {
  entity_type_id: string;
  sort_order?: number;
  allowed_units?: string[] | null;
}

// =================== FIELD MANAGEMENT TYPES ===================

/**
 * Result of field validation before operations
 */
export interface FieldValidationResult {
  canDelete: boolean;
  canUpdate: boolean;
  canChangeType: boolean;
  extractedValuesCount: number;
  affectedArticles: string[];
  message?: string;
}

/**
 * Result of field operations
 */
export interface FieldOperationResult {
  success: boolean;
  field?: ExtractionField;
  error?: string;
}

/**
 * User role in the project (for permission control)
 */
export type ProjectMemberRole = 'manager' | 'reviewer' | 'viewer' | 'consensus';

/**
 * Result of permission check
 */
export interface PermissionCheckResult {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canCreate: boolean;
  role: ProjectMemberRole | null;
  message?: string;
}

// =================== HIERARCHY TYPES ===================

/**
 * Node in the hierarchy tree of entities and instances
 * Used for recursive UI rendering
 */
export interface EntityNode {
  entityType: ExtractionEntityType;
  instances: ExtractionInstance[];
  children: EntityNode[];
}

/**
 * Full extraction hierarchy context
 * Includes tree and helper maps for fast lookups
 */
export interface ExtractionHierarchyContext {
  tree: EntityNode[];
  flatMap: Map<string, ExtractionInstance>;
  parentMap: Map<string, string>; // instance_id → parent_instance_id
  childrenMap: Map<string, ExtractionInstance[]>; // parent_id → children[]
}

/**
 * Result of recursive children query
 */
export interface InstanceChild {
  id: string;
  label: string;
  entity_type_id: string;
  level: number;
}
