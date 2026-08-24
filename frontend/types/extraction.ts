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

type ExtractionFramework = 'CHARMS' | 'PICOS' | 'CUSTOM';
export type ExtractionFieldType = 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'boolean';
export type ExtractionCardinality = 'one' | 'many';
/**
 * Structural role of an entity type within a template.
 *
 * Mirrors the backend ``ExtractionEntityRole`` enum (migration
 * ``0016_entity_role_column``). Replaces the legacy convention of
 * identifying the model container by ``name === 'prediction_models'``.
 */
export type ExtractionEntityRole = 'study_section' | 'model_container' | 'model_section';

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
  /**
   * Structural discriminant the UI partitions on. See
   * ``partitionEntityTypes`` and ``isModelContainer``.
   */
  role: ExtractionEntityRole;
  sort_order: number;
  is_required: boolean;
  /**
   * Repeating-group entry noun (B-8): set only on ``model_container``
   * rows; consumers interpolate it with a ``'model'`` fallback.
   * Required (not optional) so hand-written mirrors and adapters cannot
   * silently drop it.
   */
  entry_label: string | null;
  created_at: string;
}

/**
 * Entity type joined with its fields list — the shape the form needs to
 * render. Lives at the type layer instead of being redeclared in every
 * consumer.
 */
export interface ExtractionEntityTypeWithFields extends ExtractionEntityType {
  fields: ExtractionField[];
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
    // ADR-0016 opt-in dispositions (no_information is universal, needs no flag)
  allows_not_applicable?: boolean;
  allows_not_evaluated?: boolean;
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

  // "Other (specify)" support
  allow_other: z.boolean().default(false).optional(),
  // No default: a .default() wrapped in .optional() never fires (dead
  // code, removed at B-7) — the runtime fallback is the English copy key.
  other_label: z.string()
      .max(100, '"Other" label must be at most 100 characters')
    .optional()
    .nullable(),
  other_placeholder: z.string()
      .max(200, 'Placeholder must be at most 200 characters')
    .optional()
    .nullable(),

  // ADR-0016 opt-in disposition flags (no_information is universal, needs none)
  allows_not_applicable: z.boolean().default(false).optional(),
  allows_not_evaluated: z.boolean().default(false).optional(),

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
type ExtractionFieldInput = z.infer<typeof ExtractionFieldSchema>;

/**
 * Partial type for update (all fields optional)
 */
export type ExtractionFieldUpdate = Partial<ExtractionFieldInput>;

/**
 * Type for DB insert (adds entity_type_id)
 */
export interface ExtractionFieldInsert extends Omit<ExtractionFieldInput, 'sort_order'> {
  entity_type_id: string;
  sort_order?: number;
  allowed_units?: string[] | null;
}

// =================== FIELD MANAGEMENT TYPES ===================

// FieldValidationResult lives in services/extractionFieldService.ts, next to
// the call that produces it. The copy that used to sit here was a stale
// duplicate (message optional instead of required) that only tests reached.


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

