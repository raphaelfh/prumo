/**
 * Componente de Badge de Sugestão de IA
 * 
 * Componente vazio - funcionalidade de detalhes movida para AISuggestionDisplay
 * Mantido apenas para compatibilidade com código existente
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
  // Componente vazio - funcionalidade movida para AISuggestionDisplay
  // onde a porcentagem abre os detalhes ao clicar
  return null;
}
