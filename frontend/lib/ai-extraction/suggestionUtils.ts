/**
 * Utilities for formatting and handling AI suggestions
 *
 * Pure functions for formatting suggestion values for UI display.
 */

import type {AISuggestion} from '@/types/ai-extraction';

/**
 * Calculates formatted confidence percentage
 *
 * @param confidence - Confidence value (0-1)
 * @returns Rounded percentage (0-100)
 */
export function calculateConfidencePercent(confidence: number): number {
  return Math.round(confidence * 100);
}

/**
 * Formats suggestion value for display
 *
 * Converts values to readable string, truncating if needed.
 *
 * @param value - Value to format
 * @param maxLength - Max length (default: 40)
 * @returns Formatted string
 */
export function formatSuggestionValue(value: any, maxLength: number = 40): string {
    // Empty string is also a valid value; show "(empty)" only for null/undefined
  if (value === null || value === undefined) {
      return '(empty)';
  }

  if (value === '') {
      return '(empty)';
  }

  if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'object') {
    const str = JSON.stringify(value);
    return str.length > maxLength
      ? `${str.substring(0, maxLength)}...`
      : str;
  }

  const str = String(value);
  return str.length > maxLength
    ? `${str.substring(0, maxLength)}...`
    : str;
}

/**
 * Gets full formatted value for tooltip/expanded display
 *
 * @param value - Value to format
 * @returns Full string of value
 */
export function formatFullSuggestionValue(value: any): string {
  if (value === null || value === undefined) {
      return '(empty)';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  return JSON.stringify(value);
}

/**
 * Checks if a suggestion was accepted
 *
 * @param suggestion - Suggestion to check
 * @returns true if suggestion has status 'accepted'
 */
export function isSuggestionAccepted(suggestion: AISuggestion): boolean {
  return suggestion.status === 'accepted';
}

/**
 * Checks if a suggestion is pending
 *
 * @param suggestion - Suggestion to check
 * @returns true if suggestion has status 'pending'
 */
export function isSuggestionPending(suggestion: AISuggestion): boolean {
  return suggestion.status === 'pending';
}

/**
 * Filters suggestions by confidence threshold
 *
 * @param suggestions - Record of suggestions
 * @param threshold - Minimum confidence threshold (0-1, default: 0.8)
 * @returns Filtered array of [key, suggestion]
 */
export function filterSuggestionsByConfidence(
  suggestions: Record<string, AISuggestion>,
  threshold: number = 0.8
): Array<[string, AISuggestion]> {
  return Object.entries(suggestions).filter(
    ([, suggestion]) => suggestion.confidence >= threshold
  );
}

/**
 * Sorts suggestions by confidence (highest first)
 *
 * @param suggestions - Record of suggestions
 * @returns Sorted array of [key, suggestion]
 */
export function sortSuggestionsByConfidence(
  suggestions: Record<string, AISuggestion>
): Array<[string, AISuggestion]> {
  return Object.entries(suggestions).sort(
    ([, a], [, b]) => b.confidence - a.confidence
  );
}

