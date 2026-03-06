/**
 * Consistent value formatting for comparison
 *
 * Utility functions to format values consistently across the app (Assessment and Extraction).
 *
 * @module comparison/formatters
 */

import {t} from '@/lib/copy';

/**
 * Formats value for comparison display
 * Handles different data types consistently
 *
 * @param value - Value to format (any type)
 * @returns Formatted string for display
 */
export function formatComparisonValue(value: any): string {
  if (value === null || value === undefined || value === '') return '—';

    if (typeof value === 'boolean') return value ? t('extraction', 'yes') : t('extraction', 'no');
  
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return value.join(', ');
  }
  
  if (typeof value === 'object') {
      // Handle numeric values with unit
    if ('value' in value && 'unit' in value) {
      const numVal = value.value !== null && value.value !== undefined && value.value !== '' 
        ? String(value.value) 
        : '—';
      const unit = value.unit || '';
      return unit ? `${numVal} ${unit}` : numVal;
    }

      // Handle special JSONBs that wrap a value
    if ('value' in value) return formatComparisonValue(value.value);

      // Generic objects: JSON stringified (with length limit)
    const str = JSON.stringify(value);
    return str.length > 100 ? str.substring(0, 97) + '...' : str;
  }
  
  return String(value);
}

/**
 * Formats field type to readable label
 *
 * @param type - Field type (text, number, etc.)
 * @returns English label
 */
export function formatFieldType(type: string): string {
  const labels: Record<string, string> = {
      text: t('extraction', 'fieldTypeText'),
      number: t('extraction', 'fieldTypeNumber'),
      date: t('extraction', 'fieldTypeDate'),
      select: t('extraction', 'fieldTypeSelect'),
      multiselect: t('extraction', 'fieldTypeMultiselect'),
      boolean: t('extraction', 'fieldTypeBoolean'),
  };
  return labels[type] || type;
}

/**
 * Truncates long value for table display
 *
 * @param value - String to truncate
 * @param maxLength - Max length (default: 50)
 * @returns Truncated string with '...'
 */
export function truncateValue(value: string, maxLength: number = 50): string {
  if (value.length <= maxLength) return value;
  return value.substring(0, maxLength) + '...';
}

/**
 * Formats timestamp for relative display
 * Used to show when the last extraction was
 *
 * @param timestamp - Extraction date/time
 * @returns Formatted string (e.g. "2 min ago")
 */
export function formatRelativeTime(timestamp: Date | string): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('common', 'timeJustNow');
    if (diffMins < 60) return t('common', 'timeAgoMin').replace('{{n}}', String(diffMins));
    if (diffHours < 24) return t('common', 'timeAgoH').replace('{{n}}', String(diffHours));
    if (diffDays < 7) return t('common', 'timeAgoD').replace('{{n}}', String(diffDays));

    return date.toLocaleDateString('en-US', {day: '2-digit', month: 'short'});
}

