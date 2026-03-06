/**
 * Centralized exports for assessment (quality assessment) hooks
 *
 * Baseado em hooks/extraction/index.ts (DRY + KISS)
 */

// Hooks principais (legacy)
export { useAssessmentData } from './useAssessmentData';
export { useAssessmentResponses } from './useAssessmentResponses';
export { useAssessmentAutoSave } from './useAssessmentAutoSave';
export { useAssessmentProgress } from './useAssessmentProgress';

// Hooks principais (Assessment 2.0 - Extraction Pattern)
export { useAssessmentInstances } from './useAssessmentInstances';
export { useAssessmentResponsesNew } from './useAssessmentResponsesNew';
export { useAssessmentInstanceProgress } from './useAssessmentInstanceProgress';
export { useAssessmentInstanceHierarchy } from './useAssessmentInstanceHierarchy';

// Hooks de instrumentos de projeto
export {
  useGlobalInstruments,
  useProjectInstruments,
  useProjectInstrument,
  useHasConfiguredInstrument,
  useCloneInstrument,
  useCreateInstrument,
  useUpdateInstrument,
  useDeleteInstrument,
  useProjectAssessmentInstrumentManager,
  projectInstrumentKeys,
} from './useProjectAssessmentInstruments';

// Hooks de IA
export { useAIAssessmentSuggestions } from './ai/useAIAssessmentSuggestions';
export { useSingleAssessment } from './ai/useSingleAssessment';

// Tipos exportados (legacy)
export type {
  UseAssessmentDataReturn,
  UseAssessmentDataProps,
  DomainWithItems,
} from './useAssessmentData';

export type {
  UseAssessmentResponsesReturn,
  UseAssessmentResponsesProps,
} from './useAssessmentResponses';

export type {
  UseAssessmentAutoSaveReturn,
} from './useAssessmentAutoSave';

export type {
  UseAssessmentProgressReturn,
} from './useAssessmentProgress';

export type {
  UseAIAssessmentSuggestionsReturn,
  UseAIAssessmentSuggestionsProps,
} from './ai/useAIAssessmentSuggestions';

export type {
  UseSingleAssessmentReturn,
} from './ai/useSingleAssessment';
