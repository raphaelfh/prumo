/**
 * Custom error classes for AI Extraction
 *
 * Domain-specific errors for better handling and user-friendly messages.
 */

/**
 * Base error for AI Extraction
 */
export class AIExtractionError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AIExtractionError';
  }
}

/**
 * Error when suggestion is not found
 */
export class SuggestionNotFoundError extends AIExtractionError {
  constructor(instanceId: string, fieldId: string) {
    super(
        `Suggestion not found for instance ${instanceId} and field ${fieldId}`,
      'SUGGESTION_NOT_FOUND',
      { instanceId, fieldId }
    );
    this.name = 'SuggestionNotFoundError';
  }
}

/**
 * Error when there are no instances to extract
 */
export class NoInstancesError extends AIExtractionError {
  constructor(entityTypeId: string, entityTypeName?: string) {
    super(
      entityTypeName
          ? `No instances found for section "${entityTypeName}". Create at least one instance before extracting.`
          : `No instances found for this section. Create at least one instance before extracting.`,
      'NO_INSTANCES',
      { entityTypeId, entityTypeName }
    );
    this.name = 'NoInstancesError';
  }
}

/**
 * Error when PDF is not found
 */
export class PDFNotFoundError extends AIExtractionError {
  constructor(articleId: string) {
    super(
        'PDF not found. Upload a PDF first.',
      'PDF_NOT_FOUND',
      { articleId }
    );
    this.name = 'PDFNotFoundError';
  }
}

/**
 * Error when extracted field names do not match expected fields
 */
export class FieldNameMismatchError extends AIExtractionError {
  constructor(
    unmatchedFields: string[],
    expectedFields: string[],
    suggestions?: string[]
  ) {
    const suggestionText = suggestions && suggestions.length > 0
        ? ` Suggestions: ${suggestions.join(', ')}`
      : '';
    
    super(
        `Extracted fields do not match expected fields.${suggestionText} Check that template field names match exactly those returned by the AI.`,
      'FIELD_NAME_MISMATCH',
      { unmatchedFields, expectedFields, suggestions }
    );
    this.name = 'FieldNameMismatchError';
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends AIExtractionError {
  constructor() {
    super(
        'User not authenticated',
      'AUTH_ERROR'
    );
    this.name = 'AuthenticationError';
  }
}

/**
 * Validation error
 */
export class ValidationError extends AIExtractionError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

/**
 * Erro de rede/API
 */
export class APIError extends AIExtractionError {
  constructor(message: string, statusCode?: number, details?: unknown) {
    super(
      message,
      'API_ERROR',
      { statusCode, ...details }
    );
    this.name = 'APIError';
  }
}

/**
 * Helper to determine if an error is AIExtractionError type
 */
export function isAIExtractionError(error: unknown): error is AIExtractionError {
  return error instanceof AIExtractionError;
}

/**
 * Extracts user-friendly error message
 */
export function getErrorMessage(error: unknown): string {
  if (isAIExtractionError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

    return 'Unknown error';
}

/**
 * Extracts error code for specific handling
 */
export function getErrorCode(error: unknown): string | null {
  if (isAIExtractionError(error)) {
    return error.code;
  }

  return null;
}

