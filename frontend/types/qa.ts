/**
 * TypeScript types for the quality-assessment (QA) module.
 *
 * QA templates are the same extraction tree seen through the assessment
 * lens: a template header plus one "domain" per entity type. These
 * interfaces wrap `ExtractionEntityType`/`ExtractionField` from
 * `./extraction`, which stay the single source of truth for the tree.
 */

import type {ExtractionEntityType, ExtractionField} from '@/types/extraction';

export interface QATemplate {
  id: string;
  name: string;
  description?: string | null;
  framework: string;
  version: string;
  kind: string;
  /** Template-level declared data: `scope_rules`, `derived_judgments`. */
  schema?: Record<string, unknown> | null;
}

export interface QADomain {
  entityType: ExtractionEntityType;
  fields: ExtractionField[];
}
