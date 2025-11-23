/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Classes de erro customizadas para AI Extraction
 * 
 * Erros específicos do domínio para melhor tratamento e mensagens amigáveis.
 */

/**
 * Erro base para AI Extraction
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
 * Erro quando sugestão não é encontrada
 */
export class SuggestionNotFoundError extends AIExtractionError {
  constructor(instanceId: string, fieldId: string) {
    super(
      `Sugestão não encontrada para instância ${instanceId} e campo ${fieldId}`,
      'SUGGESTION_NOT_FOUND',
      { instanceId, fieldId }
    );
    this.name = 'SuggestionNotFoundError';
  }
}

/**
 * Erro quando não há instâncias para extrair
 */
export class NoInstancesError extends AIExtractionError {
  constructor(entityTypeId: string, entityTypeName?: string) {
    super(
      entityTypeName
        ? `Nenhuma instância encontrada para a seção "${entityTypeName}". Crie pelo menos uma instância antes de extrair.`
        : `Nenhuma instância encontrada para esta seção. Crie pelo menos uma instância antes de extrair.`,
      'NO_INSTANCES',
      { entityTypeId, entityTypeName }
    );
    this.name = 'NoInstancesError';
  }
}

/**
 * Erro quando PDF não é encontrado
 */
export class PDFNotFoundError extends AIExtractionError {
  constructor(articleId: string) {
    super(
      'PDF não encontrado. Faça upload de um PDF primeiro.',
      'PDF_NOT_FOUND',
      { articleId }
    );
    this.name = 'PDFNotFoundError';
  }
}

/**
 * Erro quando há mismatch entre nomes de campos extraídos e campos esperados
 */
export class FieldNameMismatchError extends AIExtractionError {
  constructor(
    unmatchedFields: string[],
    expectedFields: string[],
    suggestions?: string[]
  ) {
    const suggestionText = suggestions && suggestions.length > 0
      ? ` Sugestões: ${suggestions.join(', ')}`
      : '';
    
    super(
      `Campos extraídos não correspondem aos campos esperados.${suggestionText} Verifique se os nomes dos campos no template correspondem exatamente aos retornados pela IA.`,
      'FIELD_NAME_MISMATCH',
      { unmatchedFields, expectedFields, suggestions }
    );
    this.name = 'FieldNameMismatchError';
  }
}

/**
 * Erro de autenticação
 */
export class AuthenticationError extends AIExtractionError {
  constructor() {
    super(
      'Usuário não autenticado',
      'AUTH_ERROR'
    );
    this.name = 'AuthenticationError';
  }
}

/**
 * Erro de validação
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
 * Helper para determinar se um erro é do tipo AIExtractionError
 */
export function isAIExtractionError(error: unknown): error is AIExtractionError {
  return error instanceof AIExtractionError;
}

/**
 * Extrai mensagem amigável de erro
 */
export function getErrorMessage(error: unknown): string {
  if (isAIExtractionError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Erro desconhecido';
}

/**
 * Extrai código de erro para tratamento específico
 */
export function getErrorCode(error: unknown): string | null {
  if (isAIExtractionError(error)) {
    return error.code;
  }

  return null;
}

