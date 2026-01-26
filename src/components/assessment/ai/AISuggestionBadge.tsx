/**
 * Componente de Badge de Sugestão de IA - Assessment
 *
 * Componente vazio - funcionalidade de detalhes movida para AISuggestionInline
 * Mantido apenas para compatibilidade com código existente
 *
 * @component
 */

import type { AIAssessmentSuggestion } from '@/types/assessment';

// =================== INTERFACES ===================

interface AISuggestionBadgeProps {
  suggestion: AIAssessmentSuggestion;
}

// =================== COMPONENT ===================

export function AISuggestionBadge(_props: AISuggestionBadgeProps) {
  // Componente vazio - funcionalidade movida para AISuggestionInline
  // onde a porcentagem abre os detalhes ao clicar
  return null;
}
