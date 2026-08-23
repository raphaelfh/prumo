
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
}

export interface QADomain {
  entityType: ExtractionEntityType;
  fields: ExtractionField[];
}



