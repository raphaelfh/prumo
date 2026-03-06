/**
 * Utilities for parsing and normalizing values
 *
 * Pure functions for extraction values that may be in different formats
 * (object {value, unit}, raw value, etc.)
 */

/**
 * Extracts the value from a {value, unit} object or returns the raw value
 *
 * @param value - Value that may be an object or raw value
 * @returns Extracted value or original value
 */
export function extractValue(value: any): any {
  if (value === null || value === undefined) {
    return null;
  }

    // If object with 'value' property, extract it
  if (typeof value === 'object' && 'value' in value) {
    return value.value;
  }

    // Otherwise return raw value
  return value;
}

/**
 * Extracts the unit from a value (if it is a {value, unit} object)
 *
 * @param value - Value that may be an object or raw value
 * @returns Unit if available, null otherwise
 */
export function extractUnit(value: any): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'object' && 'unit' in value) {
    return value.unit || null;
  }

  return null;
}

/**
 * Checks if a value is empty (null, undefined or empty string)
 *
 * @param value - Value to check
 * @returns true if value is empty
 */
export function isEmptyValue(value: any): boolean {
  const extracted = extractValue(value);
  return extracted === null || extracted === undefined || extracted === '';
}

/**
 * Normalizes a value to standard format
 *
 * Converts empty values to null and ensures consistent format.
 *
 * @param value - Value to normalize
 * @returns Normalized value
 */
export function normalizeValue(value: any): any {
  if (isEmptyValue(value)) {
    return null;
  }

  return extractValue(value);
}

/**
 * Validates whether a value is a valid number
 *
 * @param value - Value to validate
 * @returns true if it is a valid number
 */
export function isValidNumber(value: any): boolean {
  const extracted = extractValue(value);
  
  if (extracted === null || extracted === undefined || extracted === '') {
      return false; // Empty values are not valid numbers
  }

  return !isNaN(Number(extracted));
}

/**
 * Converts value to number, returning null if invalid
 *
 * @param value - Value to convert
 * @returns Number or null if invalid
 */
export function toNumber(value: any): number | null {
  if (!isValidNumber(value)) {
    return null;
  }

  return Number(extractValue(value));
}

/**
 * Converts value to string, handling null/empty values
 *
 * @param value - Value to convert
 * @param emptyPlaceholder - Text to show when empty (default: '')
 * @returns String representing the value
 */
export function toString(value: any, emptyPlaceholder: string = ''): string {
  const extracted = extractValue(value);

  if (extracted === null || extracted === undefined) {
    return emptyPlaceholder;
  }

  if (extracted === '') {
    return emptyPlaceholder;
  }

  return String(extracted);
}

