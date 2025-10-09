/**
 * Helper para conversões e sugestões de unidades
 * 
 * Fornece unidades relacionadas para facilitar extração de dados
 * quando artigos usam unidades diferentes.
 * 
 * @module unitConversions
 */

// =================== INTERFACES ===================

export interface UnitFamily {
  category: string;
  baseUnit: string;
  relatedUnits: string[];
}

// =================== FAMÍLIAS DE UNIDADES ===================

export const UNIT_FAMILIES: Record<string, UnitFamily> = {
  // Tempo
  'years': {
    category: 'Tempo',
    baseUnit: 'years',
    relatedUnits: ['months', 'weeks', 'days', 'hours']
  },
  'months': {
    category: 'Tempo',
    baseUnit: 'months',
    relatedUnits: ['years', 'weeks', 'days']
  },
  'weeks': {
    category: 'Tempo',
    baseUnit: 'weeks',
    relatedUnits: ['years', 'months', 'days']
  },
  'days': {
    category: 'Tempo',
    baseUnit: 'days',
    relatedUnits: ['years', 'months', 'weeks', 'hours']
  },
  
  // Massa
  'kg': {
    category: 'Massa',
    baseUnit: 'kg',
    relatedUnits: ['g', 'mg', 'lb', 'oz']
  },
  'g': {
    category: 'Massa',
    baseUnit: 'g',
    relatedUnits: ['kg', 'mg', 'μg']
  },
  'lb': {
    category: 'Massa',
    baseUnit: 'lb',
    relatedUnits: ['kg', 'oz']
  },
  
  // Comprimento
  'cm': {
    category: 'Comprimento',
    baseUnit: 'cm',
    relatedUnits: ['m', 'mm', 'inches', 'feet']
  },
  'm': {
    category: 'Comprimento',
    baseUnit: 'm',
    relatedUnits: ['cm', 'mm', 'km']
  },
  'mm': {
    category: 'Comprimento',
    baseUnit: 'mm',
    relatedUnits: ['cm', 'm', 'μm']
  },
  
  // Pressão
  'mmHg': {
    category: 'Pressão',
    baseUnit: 'mmHg',
    relatedUnits: ['kPa', 'atm', 'bar']
  },
  
  // Percentual
  '%': {
    category: 'Percentual',
    baseUnit: '%',
    relatedUnits: ['decimal', 'fração', 'proporção']
  },
  
  // Contagem
  'participantes': {
    category: 'Contagem',
    baseUnit: 'participantes',
    relatedUnits: ['pacientes', 'indivíduos', 'pessoas', 'n']
  },
  'eventos': {
    category: 'Contagem',
    baseUnit: 'eventos',
    relatedUnits: ['casos', 'ocorrências', 'n']
  },
  
  // Temperatura
  '°C': {
    category: 'Temperatura',
    baseUnit: '°C',
    relatedUnits: ['°F', 'K']
  },
  
  // Volume
  'mL': {
    category: 'Volume',
    baseUnit: 'mL',
    relatedUnits: ['L', 'μL', 'dL']
  }
};

// =================== FUNÇÕES ===================

/**
 * Retorna unidades relacionadas a uma unidade base
 */
export function getRelatedUnits(baseUnit: string | null | undefined): string[] {
  if (!baseUnit) return [];
  
  const family = UNIT_FAMILIES[baseUnit];
  if (!family) return [];
  
  return family.relatedUnits;
}

/**
 * Retorna todas as unidades disponíveis por categoria
 */
export function getAllUnitsByCategory(): Record<string, string[]> {
  const categories: Record<string, string[]> = {};
  
  Object.values(UNIT_FAMILIES).forEach(family => {
    if (!categories[family.category]) {
      categories[family.category] = [];
    }
    if (!categories[family.category].includes(family.baseUnit)) {
      categories[family.category].push(family.baseUnit);
    }
    family.relatedUnits.forEach(unit => {
      if (!categories[family.category].includes(unit)) {
        categories[family.category].push(unit);
      }
    });
  });
  
  return categories;
}

/**
 * Normaliza unidade (trata variações comuns)
 */
export function normalizeUnit(unit: string | null | undefined): string | null {
  if (!unit) return null;
  
  const normalized = unit.trim().toLowerCase();
  
  // Mapeamento de variações comuns
  const variations: Record<string, string> = {
    'ano': 'years',
    'anos': 'years',
    'year': 'years',
    'mês': 'months',
    'meses': 'months',
    'month': 'months',
    'dia': 'days',
    'dias': 'days',
    'day': 'days',
    'quilograma': 'kg',
    'quilogramas': 'kg',
    'kilograma': 'kg',
    'kilogram': 'kg',
    'grama': 'g',
    'gramas': 'g',
    'gram': 'g',
    'percent': '%',
    'percentage': '%',
    'porcento': '%',
    'porcentagem': '%',
  };
  
  return variations[normalized] || unit;
}

/**
 * Verifica se uma unidade é válida
 */
export function isValidUnit(unit: string | null | undefined): boolean {
  if (!unit) return false;
  return Object.keys(UNIT_FAMILIES).includes(unit);
}

/**
 * Retorna unidade padrão se nenhuma for especificada
 */
export function getDefaultUnit(fieldType: string): string | null {
  // Por enquanto retorna null, mas pode ser expandido
  return null;
}

