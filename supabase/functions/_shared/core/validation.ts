/**
 * Validator Centralizado para Edge Functions
 * 
 * Validação de dados usando Zod com tratamento de erros consistente.
 * 
 * CARACTERÍSTICAS:
 * - Validação type-safe com Zod
 * - Erros formatados de forma consistente
 * - Integração com AppError
 */

import { z } from "npm:zod@3.23.8";
import { AppError, ErrorCode } from "./error-handler.ts";

/**
 * Validador centralizado
 */
export class Validator {
  /**
   * Valida dados usando schema Zod
   * 
   * @param schema - Schema Zod para validação
   * @param data - Dados a validar
   * @returns Dados validados (tipo inferido do schema)
   * @throws AppError se validação falhar
   */
  static validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
    try {
      return schema.parse(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Formatar erros do Zod de forma mais legível
        const formattedErrors = error.errors.map((err) => ({
          path: err.path.join("."),
          message: err.message,
          code: err.code,
        }));

        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Validation failed",
          400,
          {
            errors: formattedErrors,
            rawError: error.message,
          },
        );
      }

      // Erro desconhecido
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        "Validation error occurred",
        400,
        {
          error: String(error),
        },
      );
    }
  }

  /**
   * Valida dados de forma segura (não lança exceção)
   * 
   * @param schema - Schema Zod para validação
   * @param data - Dados a validar
   * @returns Resultado da validação (success: true/false)
   */
  static safeValidate<T>(
    schema: z.ZodSchema<T>,
    data: unknown,
  ): { success: true; data: T } | { success: false; error: z.ZodError } {
    const result = schema.safeParse(data);

    if (result.success) {
      return { success: true, data: result.data };
    }

    return { success: false, error: result.error };
  }
}
