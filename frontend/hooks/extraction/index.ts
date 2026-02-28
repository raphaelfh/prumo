/**
 * Exportações centralizadas dos hooks de extração
 */

export { useExtractionTemplates } from './useExtractionTemplates';
export { useExtractionInstances } from './useExtractionInstances';
export { useExtractedValues } from './useExtractedValues';
export { useExtractionSetup } from './useExtractionSetup';
export { useFieldManagement } from './useFieldManagement';
export { useExtractionAutoSave } from './useExtractionAutoSave';
export { useExtractionProgress } from './useExtractionProgress';
export { useGlobalTemplates } from './useGlobalTemplates';

export type {
  ExtractionProgress,
  ExtractionSetupResult,
} from './useExtractionSetup';

export type {
  UseExtractionAutoSaveReturn
} from './useExtractionAutoSave';

export type {
  UseExtractionProgressReturn
} from './useExtractionProgress';

