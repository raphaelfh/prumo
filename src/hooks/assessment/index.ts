/**
 * Exportações centralizadas dos hooks de assessment (avaliação de qualidade)
 *
 * Baseado em hooks/extraction/index.ts (DRY + KISS)
 */

// Hooks principais
export { useAssessmentData } from './useAssessmentData';
export { useAssessmentResponses } from './useAssessmentResponses';
export { useAssessmentAutoSave } from './useAssessmentAutoSave';
export { useAssessmentProgress } from './useAssessmentProgress';

// Hooks de IA
export { useAIAssessmentSuggestions } from './ai/useAIAssessmentSuggestions';
export { useSingleAssessment } from './ai/useSingleAssessment';

// Tipos exportados
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
