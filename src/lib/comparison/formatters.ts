/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Formatação consistente de valores para comparação
 * 
 * Funções utilitárias para formatar valores de forma consistente
 * em toda a aplicação (Assessment e Extraction).
 * 
 * @module comparison/formatters
 */

/**
 * Formata valor para exibição em comparação
 * Lida com diferentes tipos de dados de forma consistente
 * 
 * @param value - Valor a ser formatado (any type)
 * @returns String formatada para exibição
 * 
 * @example
 * formatComparisonValue(null) // '—'
 * formatComparisonValue(true) // 'Sim'
 * formatComparisonValue(['a', 'b']) // 'a, b'
 */
export function formatComparisonValue(value: any): string {
  if (value === null || value === undefined || value === '') return '—';
  
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return value.join(', ');
  }
  
  if (typeof value === 'object') {
    // ✅ NOVO: Tratar valores numéricos com unidade
    if ('value' in value && 'unit' in value) {
      const numVal = value.value !== null && value.value !== undefined && value.value !== '' 
        ? String(value.value) 
        : '—';
      const unit = value.unit || '';
      return unit ? `${numVal} ${unit}` : numVal;
    }
    
    // Tratar JSONBs especiais que encapsulam valor
    if ('value' in value) return formatComparisonValue(value.value);
    
    // Objetos genéricos: JSON stringified (mas limitado)
    const str = JSON.stringify(value);
    return str.length > 100 ? str.substring(0, 97) + '...' : str;
  }
  
  return String(value);
}

/**
 * Formata tipo de campo para label legível
 * 
 * @param type - Tipo do campo (text, number, etc)
 * @returns Label em português
 */
export function formatFieldType(type: string): string {
  const labels: Record<string, string> = {
    text: 'Texto',
    number: 'Número',
    date: 'Data',
    select: 'Seleção',
    multiselect: 'Múltipla Escolha',
    boolean: 'Sim/Não'
  };
  return labels[type] || type;
}

/**
 * Trunca valor longo para exibição em tabela
 * 
 * @param value - String a ser truncada
 * @param maxLength - Tamanho máximo (default: 50)
 * @returns String truncada com '...'
 */
export function truncateValue(value: string, maxLength: number = 50): string {
  if (value.length <= maxLength) return value;
  return value.substring(0, maxLength) + '...';
}

/**
 * Formata timestamp para exibição relativa
 * Usado para mostrar quando foi a última extração
 * 
 * @param timestamp - Data/hora da extração
 * @returns String formatada (ex: "há 2 horas")
 */
export function formatRelativeTime(timestamp: Date | string): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'agora mesmo';
  if (diffMins < 60) return `há ${diffMins} min`;
  if (diffHours < 24) return `há ${diffHours}h`;
  if (diffDays < 7) return `há ${diffDays}d`;
  
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

