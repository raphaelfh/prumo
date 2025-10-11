/**
 * Tipos para Projects e configurações
 * 
 * Centraliza interfaces relacionadas a projetos para evitar 'any'
 * e garantir type safety.
 */

export interface ProjectData {
  id: string;
  name: string;
  description: string | null;
  review_title: string | null;
  condition_studied: string | null;
  review_rationale: string | null;
  review_keywords: string[];
  eligibility_criteria: EligibilityCriteria;
  study_design: StudyDesign;
  review_context: string | null;
  search_strategy: string | null;
  settings: ProjectSettings;
  assessment_scope?: 'article' | 'extraction_instance';
  assessment_entity_type_id?: string | null;
  risk_of_bias_instrument_id?: string | null;
  created_by_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectSettings {
  blind_mode?: boolean;
  [key: string]: unknown;
}

export interface EligibilityCriteria {
  inclusion?: string[];
  exclusion?: string[];
  notes?: string;
  [key: string]: unknown;
}

export interface StudyDesign {
  types?: string[];
  notes?: string;
  [key: string]: unknown;
}

export interface ProjectConfigData {
  description: string | null;
  review_title: string | null;
  condition_studied: string | null;
  eligibility_criteria: EligibilityCriteria;
  study_design: StudyDesign;
}

