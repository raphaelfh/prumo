/**
 * AI suggestion badge component
 *
 * Empty component - detail functionality moved to AISuggestionDisplay
 * Kept only for compatibility with existing code
 * 
 * @component
 */

import type {AISuggestion} from '@/hooks/extraction/ai/useAISuggestions';

// =================== INTERFACES ===================

interface AISuggestionBadgeProps {
  suggestion: AISuggestion;
}

// =================== COMPONENT ===================

export function AISuggestionBadge(_props: AISuggestionBadgeProps) {
    // Empty component - functionality moved to AISuggestionDisplay
  // onde a porcentagem abre os detalhes ao clicar
  return null;
}
