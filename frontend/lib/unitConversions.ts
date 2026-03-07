/**
 * Helper for unit conversions and suggestions
 *
 * Provides related units to ease data extraction when articles use different units.
 *
 * @module unitConversions
 */

// =================== INTERFACES ===================

export interface UnitFamily {
  category: string;
  baseUnit: string;
  relatedUnits: string[];
}

// =================== UNIT FAMILIES ===================

export const UNIT_FAMILIES: Record<string, UnitFamily> = {
    // Time
  'years': {
      category: 'Time',
    baseUnit: 'years',
    relatedUnits: ['months', 'weeks', 'days', 'hours']
  },
  'months': {
      category: 'Time',
    baseUnit: 'months',
    relatedUnits: ['years', 'weeks', 'days']
  },
  'weeks': {
      category: 'Time',
    baseUnit: 'weeks',
    relatedUnits: ['years', 'months', 'days']
  },
  'days': {
      category: 'Time',
    baseUnit: 'days',
    relatedUnits: ['years', 'months', 'weeks', 'hours']
  },

    // Mass
  'kg': {
      category: 'Mass',
    baseUnit: 'kg',
    relatedUnits: ['g', 'mg', 'lb', 'oz']
  },
  'g': {
      category: 'Mass',
    baseUnit: 'g',
    relatedUnits: ['kg', 'mg', 'μg']
  },
  'lb': {
      category: 'Mass',
    baseUnit: 'lb',
    relatedUnits: ['kg', 'oz']
  },

    // Length
  'cm': {
      category: 'Length',
    baseUnit: 'cm',
    relatedUnits: ['m', 'mm', 'inches', 'feet']
  },
  'm': {
      category: 'Length',
    baseUnit: 'm',
    relatedUnits: ['cm', 'mm', 'km']
  },
  'mm': {
      category: 'Length',
    baseUnit: 'mm',
    relatedUnits: ['cm', 'm', 'μm']
  },

    // Pressure
  'mmHg': {
      category: 'Pressure',
    baseUnit: 'mmHg',
    relatedUnits: ['kPa', 'atm', 'bar']
  },

    // Percentage
  '%': {
      category: 'Percentage',
    baseUnit: '%',
      relatedUnits: ['decimal', 'fraction', 'proportion']
  },

    // Count
  'participantes': {
      category: 'Count',
    baseUnit: 'participantes',
    relatedUnits: ['pacientes', 'indivíduos', 'pessoas', 'n']
  },
  'eventos': {
      category: 'Count',
    baseUnit: 'eventos',
    relatedUnits: ['casos', 'ocorrências', 'n']
  },

    // Temperature
  '°C': {
      category: 'Temperature',
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

// =================== FUNCTIONS ===================

/**
 * Returns units related to a base unit
 */
export function getRelatedUnits(baseUnit: string | null | undefined): string[] {
  if (!baseUnit) return [];
  
  const family = UNIT_FAMILIES[baseUnit];
  if (!family) return [];
  
  return family.relatedUnits;
}

/**
 * Returns all available units by category
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
 * Normalizes unit (handles common variations)
 */
export function normalizeUnit(unit: string | null | undefined): string | null {
  if (!unit) return null;
  
  const normalized = unit.trim().toLowerCase();

    // Map of common variations
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
    // PT/EN variations normalized to canonical unit keys
  
  return variations[normalized] || unit;
}

/**
 * Checks if a unit is valid
 */
export function isValidUnit(unit: string | null | undefined): boolean {
  if (!unit) return false;
  return Object.keys(UNIT_FAMILIES).includes(unit);
}

/**
 * Returns default unit when none is specified
 */
export function getDefaultUnit(_fieldType: string): string | null {
    // For now returns null; can be extended later
  return null;
}

