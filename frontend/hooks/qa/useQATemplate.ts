
import type {
  ExtractionEntityType,
  ExtractionField,
} from "@/types/extraction";

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



