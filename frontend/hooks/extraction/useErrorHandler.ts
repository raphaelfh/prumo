/**
 * Hook para gerenciamento centralizado de erros
 * 
 * Fornece funções utilitárias para tratamento consistente de erros
 * em operações de CRUD de campos.
 * 
 * @module hooks/extraction/useErrorHandler
 */

import {useCallback} from 'react';
import {toast} from 'sonner';

interface ErrorHandlerOptions {
  showToast?: boolean;
  logError?: boolean;
  fallbackMessage?: string;
}

export function useErrorHandler() {
  const handleError = useCallback((
    error: unknown,
    context: string,
    options: ErrorHandlerOptions = {}
  ) => {
    const {
      showToast = true,
      logError = true,
      fallbackMessage = 'Ocorreu um erro inesperado'
    } = options;

    const errorMessage = error instanceof Error 
      ? error.message 
      : typeof error === 'string' 
        ? error 
        : fallbackMessage;

    if (logError) {
      console.error(`[${context}]:`, error);
    }

    if (showToast) {
      toast.error(`${context}: ${errorMessage}`);
    }

    return errorMessage;
  }, []);

  const handleFieldValidationError = useCallback((error: unknown) => {
    return handleError(error, 'Erro ao validar campo', {
      fallbackMessage: 'Não foi possível validar o campo'
    });
  }, [handleError]);

  const handleFieldOperationError = useCallback((
    error: unknown,
    operation: 'criar' | 'editar' | 'excluir' | 'validar'
  ) => {
    const contextMap = {
      criar: 'Erro ao criar campo',
      editar: 'Erro ao editar campo',
      excluir: 'Erro ao excluir campo',
      validar: 'Erro ao validar campo'
    };

    return handleError(error, contextMap[operation], {
      fallbackMessage: `Não foi possível ${operation} o campo`
    });
  }, [handleError]);

  const handlePermissionError = useCallback((operation: string) => {
    const message = `Você não tem permissão para ${operation}`;
    toast.error(message);
    return message;
  }, []);

  const handleValidationError = useCallback((error: unknown) => {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'ZodError') {
      const zodError = error as any;
      const firstError = zodError.errors?.[0];
      if (firstError?.message) {
        toast.error(`Validação: ${firstError.message}`);
        return firstError.message;
      }
    }
    
    return handleError(error, 'Erro de validação', {
      fallbackMessage: 'Dados inválidos fornecidos'
    });
  }, [handleError]);

  return {
    handleError,
    handleFieldValidationError,
    handleFieldOperationError,
    handlePermissionError,
    handleValidationError,
  };
}
