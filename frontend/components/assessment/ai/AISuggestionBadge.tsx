/**
 * AI suggestion badge component - Assessment
 *
 * Empty component - detail functionality moved to AISuggestionInline
 * Kept only for compatibility with existing code
 *
 * @component
 */

import type {AIAssessmentSuggestion} from '@/types/assessment';

// =================== INTERFACES ===================

interface AISuggestionBadgeProps {
  suggestion: AIAssessmentSuggestion;
}

// =================== COMPONENT ===================

export function AISuggestionBadge(_props: AISuggestionBadgeProps) {
    // Empty component - functionality moved to AISuggestionInline
    // where clicking the percentage opens details
  return null;
}
