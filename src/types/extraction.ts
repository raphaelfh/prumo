/**
 * Tipos TypeScript para o módulo de extração de dados
 * 
 * Este arquivo define todas as interfaces e tipos necessários
 * para o sistema de extração de dados estruturados.
 */

// =================== ENUMS ===================

export type ExtractionFramework = 'CHARMS' | 'PICOS' | 'CUSTOM';
export type ExtractionFieldType = 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'boolean';
export type ExtractionCardinality = 'one' | 'many';
export type ExtractionSource = 'human' | 'ai' | 'rule';
export type ExtractionRunStage = 'data_suggest' | 'parsing' | 'validation' | 'consensus';
export type ExtractionRunStatus = 'pending' | 'running' | 'completed' | 'failed';
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';

// =================== TEMPLATES ===================

export interface ExtractionTemplate {
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
  sort_order: number;
  created_at: string;
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

export interface ExtractionRun {
  id: string;
  project_id: string;
  article_id: string;
  template_id: string;
  stage: ExtractionRunStage;
  status: ExtractionRunStatus;
  parameters: any;
  results: any;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_by: string;
  created_at: string;
}

export interface AISuggestion {
  id: string;
  run_id: string;
  instance_id: string | null;
  field_id: string;
  suggested_value: any;
  confidence_score: number | null;
  reasoning: string | null;
  status: SuggestionStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

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
