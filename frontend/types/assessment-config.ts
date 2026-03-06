/**
 * Types for assessment configuration in projects
 * 
 * Suporta dois modos:
 * - 'article': One assessment per article (legacy/default mode)
 * - 'extraction_instance': One assessment per extraction instance (e.g. per model)
 */

import {ExtractionEntityType} from './extraction';

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


