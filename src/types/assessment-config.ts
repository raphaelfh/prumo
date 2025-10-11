/**
 * Tipos para configuração de assessment em projetos
 * 
 * Suporta dois modos:
 * - 'article': Um assessment por artigo (modo legado/padrão)
 * - 'extraction_instance': Um assessment por instância de extraction (ex: por modelo)
 */

import { ExtractionEntityType } from './extraction';

export type AssessmentScope = 'article' | 'extraction_instance';

export interface ProjectAssessmentConfig {
  scope: AssessmentScope;
  entityTypeId: string | null;
  entityType?: ExtractionEntityType;
}

export interface AssessmentConfigValidation {
  canChangeScope: boolean;
  reason?: string;
  existingAssessmentsCount?: number;
}


