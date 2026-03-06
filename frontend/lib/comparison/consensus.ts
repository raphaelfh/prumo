/**
 * Consensus detection and agreement calculation
 *
 * Business logic for consensus analysis across multiple reviewers.
 * Reusable in Assessment and Extraction.
 *
 * @module comparison/consensus
 */

import {formatComparisonValue} from './formatters';

/**
 * Result of consensus analysis
 */
export interface ConsensusResult {
    value: string | null;          // Consensus value
    count: number;                  // How many users have this value
    total: number;                  // Total non-empty values
    percentage: number;             // Agreement % (0-100)
    hasConsensus: boolean;          // Whether threshold was met
    threshold: number;              // Threshold used (0-100)
}

/**
 * Detects consensus in an array of values
 *
 * Algorithm:
 * 1. Filter empty values
 * 2. Group equal values (using formatComparisonValue)
 * 3. Find most frequent value
 * 4. Check if threshold is met (default: 50%)
 *
 * @param values - Array of values from different users
 * @param threshold - Minimum % for consensus (0-1, default: 0.5)
 * @returns ConsensusResult or null if no values
 */
export function detectConsensus(
  values: any[],
  threshold: number = 0.5
): ConsensusResult | null {
    // Validate threshold
  if (threshold < 0 || threshold > 1) {
      throw new Error('Threshold must be between 0 and 1');
  }

    // Check if ALL values are empty (implicit consensus)
  const allEmpty = values.every(v => v === null || v === undefined || v === '');
  
  if (allEmpty) {
      // Implicit consensus: all agree to leave empty
    return {
      value: '—',
      count: values.length,
      total: values.length,
      percentage: 100,
      hasConsensus: true,
      threshold: Math.round(threshold * 100)
    };
  }

    // Filter empty values
  const nonEmpty = values.filter(v => 
    v !== null && v !== undefined && v !== ''
  );

    if (nonEmpty.length === 0) return null; // Should not reach here after above check

    // Group by formatted value (for consistent comparison)
  const counts: Record<string, number> = {};
  nonEmpty.forEach(v => {
    const formatted = formatComparisonValue(v);
    counts[formatted] = (counts[formatted] || 0) + 1;
  });

  // Encontrar valor mais frequente
  let maxCount = 0;
  let consensusValue: string | null = null;

  Object.entries(counts).forEach(([value, count]) => {
    if (count > maxCount) {
      maxCount = count;
      consensusValue = value;
    }
  });

  const total = nonEmpty.length;
  const percentage = Math.round((maxCount / total) * 100);
  const hasConsensus = maxCount > 1 && (maxCount / total) >= threshold;

  return {
    value: consensusValue,
    count: maxCount,
    total,
    percentage,
    hasConsensus,
    threshold: Math.round(threshold * 100)
  };
}

/**
 * Calculates agreement between two sets of values
 * Useful for user vs user comparison
 *
 * @param values1 - First set (key -> value)
 * @param values2 - Second set (key -> value)
 * @returns Agreement statistics
 */
export function calculateConcordance(
  values1: Record<string, any>,
  values2: Record<string, any>
): { matches: number; total: number; percentage: number } {
  const commonKeys = Object.keys(values1).filter(k => k in values2);
  
  if (commonKeys.length === 0) {
    return { matches: 0, total: 0, percentage: 0 };
  }

  const matches = commonKeys.filter(k => 
    formatComparisonValue(values1[k]) === formatComparisonValue(values2[k])
  ).length;

  const percentage = Math.round((matches / commonKeys.length) * 100);

  return { matches, total: commonKeys.length, percentage };
}

/**
 * Groups values by user
 * Helper to turn array into Map keyed by userId
 *
 * @param extractions - Array of extractions/assessments
 * @returns Map of userId -> values
 */
export function groupValuesByUser<T extends { userId: string; values: Record<string, any> }>(
  extractions: T[]
): Map<string, Record<string, any>> {
  const grouped = new Map<string, Record<string, any>>();
  
  extractions.forEach(ext => {
    grouped.set(ext.userId, ext.values);
  });

  return grouped;
}

/**
 * Calculates divergence statistics for a set of fields
 * Returns how many fields have consensus vs divergence
 *
 * @param fieldValues - Map of fieldId -> array of values
 * @param threshold - Consensus threshold
 * @returns Aggregated statistics
 */
export function calculateDivergenceStats(
  fieldValues: Map<string, any[]>,
  threshold: number = 0.5
): {
  totalFields: number;
  consensusFields: number;
  divergentFields: number;
  consensusPercentage: number;
} {
  let consensusFields = 0;
  let divergentFields = 0;

  fieldValues.forEach((values) => {
    const consensus = detectConsensus(values, threshold);
    if (consensus?.hasConsensus) {
      consensusFields++;
    } else if (consensus) {
      divergentFields++;
    }
  });

  const totalFields = consensusFields + divergentFields;
  const consensusPercentage = totalFields > 0 
    ? Math.round((consensusFields / totalFields) * 100)
    : 0;

  return {
    totalFields,
    consensusFields,
    divergentFields,
    consensusPercentage
  };
}

