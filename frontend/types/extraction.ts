/**
 * Tipos TypeScript para o módulo de extração de dados
 * 
 * Este arquivo define todas as interfaces e tipos necessários
 * para o sistema de extração de dados estruturados.
 * 
 * Inclui schemas Zod para validação runtime.
 */

import {z} from 'zod';

// =================== ENUMS ===================

export type ExtractionFramework = 'CHARMS' | 'PICOS' | 'CUSTOM';
export type ExtractionFieldType = 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'boolean';
export type ExtractionCardinality = 'one' | 'many';
export type ExtractionSource = 'human' | 'ai' | 'rule';
export type ExtractionRunStage = 'data_suggest' | 'parsing' | 'validation' | 'consensus';
export type ExtractionRunStatus = 'pending' | 'running' | 'completed' | 'failed';
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';

/**
 * Tipo para valores de extração baseado no tipo de campo
 * Garante type safety ao invés de usar `any`
 */
export type ExtractionValue = 
  | string      // text, select
  | number      // number
  | Date        // date
  | string[]    // multiselect
  | boolean     // boolean
  | null;       // valores não preenchidos

// Valores com suporte a "Outro (especificar)"
export type SelectSingleValue = 
  | string
  | { selected: 'other'; other_text: string };

export type SelectMultiValue = 
  | string[]
  | { selected: string[]; other_texts: string[] };

// =================== TEMPLATES ===================

/**
 * Template global padronizado (CHARMS, PICOS, PRISMA, etc.)
 * Mantido por administradores, read-only para usuários
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

// Alias para compatibilidade (deprecated, usar GlobalExtractionTemplate)
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
  allowed_units: string[] | null; // Unidades alternativas configuráveis para campos numéricos
  llm_description: string | null; // Instrução específica para extração com IA
  sort_order: number;
  created_at: string;
  // Suporte a "Outro (especificar)" inline
  allow_other?: boolean;
  other_label?: string | null;
  other_placeholder?: string | null;
}

// =================== INSTÂNCIAS E VALORES ===================

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
 * @deprecated Use ExtractionRunRaw from '@/types/ai-extraction' para dados do banco
 * Use ExtractionRun from '@/types/ai-extraction' para dados processados
 * 
 * Mantido apenas para compatibilidade com código legado.
 */
export type { ExtractionRunRaw as ExtractionRun } from '@/types/ai-extraction';

/**
 * @deprecated Use AISuggestionRaw from '@/types/ai-extraction' para dados do banco
 * Use AISuggestion from '@/types/ai-extraction' para dados processados
 * 
 * Mantido apenas para compatibilidade com código legado.
 */
export type { AISuggestionRaw as AISuggestion } from '@/types/ai-extraction';

// Re-exportar tipos relacionados para conveniência
export type { SuggestionStatus, ExtractionRunStatus, ExtractionRunStage } from '@/types/ai-extraction';

// =================== TIPOS PARA INSERÇÃO ===================

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

// =================== TIPOS PARA FORMULÁRIOS ===================

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

// =================== TIPOS PARA UI ===================

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

// =================== TIPOS PARA EXPORTAÇÃO ===================

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

// =================== TIPOS PARA VALIDAÇÃO ===================

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

// =================== ZOD SCHEMAS (Validação Runtime) ===================

/**
 * Schema Zod para validação de campo de extração
 * Usado ao criar ou editar campos
 */
export const ExtractionFieldSchema = z.object({
  name: z.string()
    .regex(/^[a-z][a-z0-9_]*$/, 'Nome deve estar em snake_case (ex: campo_exemplo)')
    .min(2, 'Nome deve ter no mínimo 2 caracteres')
    .max(50, 'Nome deve ter no máximo 50 caracteres'),
  
  label: z.string()
    .min(1, 'Label é obrigatório')
    .max(100, 'Label deve ter no máximo 100 caracteres'),
  
  description: z.string()
    .max(500, 'Descrição deve ter no máximo 500 caracteres')
    .optional()
    .nullable(),
  
  field_type: z.enum(['text', 'number', 'date', 'select', 'multiselect', 'boolean'], {
    errorMap: () => ({ message: 'Tipo de campo inválido' }),
  }),
  
  is_required: z.boolean().default(false),
  
  unit: z.string()
    .max(50, 'Unidade deve ter no máximo 50 caracteres')
    .optional()
    .nullable(),
  
  allowed_units: z.array(z.string().max(50))
    .min(1, 'Deve ter pelo menos uma unidade alternativa')
    .max(20, 'Máximo de 20 unidades alternativas')
    .optional()
    .nullable()
    .refine(
      (units) => {
        if (!units) return true;
        const unique = new Set(units);
        return unique.size === units.length;
      },
      { message: 'Unidades não podem ter duplicatas' }
    ),
  
  llm_description: z.string()
    .max(1000, 'Instrução para IA deve ter no máximo 1000 caracteres')
    .optional()
    .nullable(),
  
  allowed_values: z.array(z.string())
    .min(1, 'Deve ter pelo menos um valor permitido')
    .max(100, 'Máximo de 100 valores permitidos')
    .optional()
    .nullable()
    .refine(
      (values) => {
        if (!values) return true;
        const unique = new Set(values);
        return unique.size === values.length;
      },
      { message: 'Valores permitidos não podem ter duplicatas' }
    ),

  // Suporte a "Outro (especificar)"
  allow_other: z.boolean().default(false).optional(),
  other_label: z.string()
    .max(100, 'Label do "Outro" deve ter no máximo 100 caracteres')
    .default('Outro (especificar)')
    .optional()
    .nullable(),
  other_placeholder: z.string()
    .max(200, 'Placeholder deve ter no máximo 200 caracteres')
    .optional()
    .nullable(),
  
  validation_schema: z.record(z.any())
    .optional()
    .nullable(),
  
  sort_order: z.number()
    .int('Ordem deve ser um número inteiro')
    .min(0, 'Ordem deve ser maior ou igual a 0')
    .default(0),
});

/**
 * Tipo inferido do schema Zod
 */
export type ExtractionFieldInput = z.infer<typeof ExtractionFieldSchema>;

/**
 * Schema parcial para atualização (todos os campos opcionais)
 */
export const ExtractionFieldUpdateSchema = ExtractionFieldSchema.partial();
export type ExtractionFieldUpdate = z.infer<typeof ExtractionFieldUpdateSchema>;

/**
 * Tipo para inserção no banco (adiciona entity_type_id)
 */
export interface ExtractionFieldInsert extends Omit<ExtractionFieldInput, 'sort_order'> {
  entity_type_id: string;
  sort_order?: number;
  allowed_units?: string[] | null;
}

// =================== TIPOS PARA GERENCIAMENTO DE CAMPOS ===================

/**
 * Resultado da validação de um campo antes de operações
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
 * Resultado de operações de campo
 */
export interface FieldOperationResult {
  success: boolean;
  field?: ExtractionField;
  error?: string;
}

/**
 * Role do usuário no projeto (para controle de permissões)
 */
export type ProjectMemberRole = 'manager' | 'reviewer' | 'viewer' | 'consensus';

/**
 * Resultado de verificação de permissões
 */
export interface PermissionCheckResult {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canCreate: boolean;
  role: ProjectMemberRole | null;
  message?: string;
}

// =================== TIPOS PARA HIERARQUIA ===================

/**
 * Nó na árvore hierárquica de entities e instances
 * Usado para renderização recursiva de UI
 */
export interface EntityNode {
  entityType: ExtractionEntityType;
  instances: ExtractionInstance[];
  children: EntityNode[];
}

/**
 * Contexto completo da hierarquia de extraction
 * Inclui árvore e maps auxiliares para queries rápidas
 */
export interface ExtractionHierarchyContext {
  tree: EntityNode[];
  flatMap: Map<string, ExtractionInstance>;
  parentMap: Map<string, string>; // instance_id → parent_instance_id
  childrenMap: Map<string, ExtractionInstance[]>; // parent_id → children[]
}

/**
 * Resultado de query recursiva de children
 */
export interface InstanceChild {
  id: string;
  label: string;
  entity_type_id: string;
  level: number;
}
