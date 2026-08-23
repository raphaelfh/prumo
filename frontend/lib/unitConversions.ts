/**
 * Helper for unit conversions and suggestions
 *
 * Provides related units to ease data extraction when articles use different units.
 *
 * @module unitConversions
 */

// =================== INTERFACES ===================

interface UnitFamily {
  category: string;
  baseUnit: string;
  relatedUnits: string[];
}

// =================== UNIT FAMILIES ===================

const UNIT_FAMILIES: Record<string, UnitFamily> = {
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





