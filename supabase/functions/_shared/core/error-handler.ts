/**
 * Error Handler Centralizado para Edge Functions
 * 
 * Tratamento consistente de erros com códigos padronizados e formatação adequada.
 * 
 * CARACTERÍSTICAS:
 * - Códigos de erro padronizados (ErrorCode enum)
 * - Classe AppError customizada com contexto
 * - Formatação consistente de respostas de erro
 * - Logging automático de erros
 */

import type { Logger } from "./logger.ts";

/**
 * Códigos de erro padronizados
 */
export enum ErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  AUTH_ERROR = "AUTH_ERROR",
  NOT_FOUND = "NOT_FOUND",
  DB_ERROR = "DB_ERROR",
  PDF_PROCESSING_ERROR = "PDF_PROCESSING_ERROR",
  LLM_ERROR = "LLM_ERROR",
  TIMEOUT = "TIMEOUT",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

/**
 * Classe de erro customizada com contexto
 */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 500,
    public details?: Record<string, any>,
  ) {
    super(message);
    this.name = "AppError";
    // Manter stack trace se disponível
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * Converter para formato JSON para resposta HTTP
   */
  toJSON(): {
    code: string;
    message: string;
    details?: Record<string, any>;
  } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details && { details: this.details }),
    };
  }
}

/**
 * Error Handler para formatação consistente de respostas de erro
 */
export class ErrorHandler {
  /**
   * Processa erro e retorna resposta HTTP formatada
   */
  static handle(error: unknown, logger: Logger): Response {
    let appError: AppError;
    let statusCode = 500;

    if (error instanceof AppError) {
      appError = error;
      statusCode = error.statusCode;
    } else if (error instanceof Error) {
      // Converter erro genérico para AppError
      appError = new AppError(
        ErrorCode.INTERNAL_ERROR,
        error.message || "Internal server error",
        500,
        {
          originalError: error.name,
          stack: error.stack,
        },
      );
    } else {
      // Erro desconhecido
      appError = new AppError(
        ErrorCode.INTERNAL_ERROR,
        "An unexpected error occurred",
        500,
        {
          error: String(error),
        },
      );
    }

    // Log do erro
    logger.error("Error handled", appError, {
      code: appError.code,
      statusCode: appError.statusCode,
      details: appError.details,
    });

    // Retornar resposta JSON formatada
    // CRÍTICO: Incluir todos os headers CORS para evitar problemas no frontend
    return new Response(
      JSON.stringify({
        ok: false,
        error: appError.toJSON(),
      }),
      {
        status: statusCode,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-client-trace-id",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
      },
    );
  }
}

