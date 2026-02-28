/**
 * Tipos para Projects e configurações
 * 
 * Centraliza interfaces relacionadas a projetos para evitar 'any'
 * e garantir type safety.
 * 
 * Baseado nos tipos gerados do Supabase para garantir consistência.
 */

import type {Database} from '@/integrations/supabase/types';

/**
 * Tipo base de Project do banco de dados
 * Usa o tipo gerado do Supabase para garantir type safety
 */
export type Project = Database['public']['Tables']['projects']['Row'];

/**
 * Tipo para inserção de Project
 */
export type ProjectInsert = Database['public']['Tables']['projects']['Insert'];

/**
 * Tipo para atualização de Project
 */
export type ProjectUpdate = Partial<Omit<Project, 'id' | 'created_at'>>;

/**
 * Tipo completo de Project com todas as configurações
 * Mantido para compatibilidade com código existente
 */
export interface ProjectData extends Project {
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

