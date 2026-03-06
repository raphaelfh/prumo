/**
 * Centralized error handling hook
 *
 * Provides utility functions for consistent error handling
 * in field CRUD operations.
 *
 * @module hooks/extraction/useErrorHandler
 */

import {useCallback} from 'react';
import {toast} from 'sonner';
import {t} from '@/lib/copy';

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
        fallbackMessage = t('extraction', 'errorHandlerFallback')
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
      return handleError(error, t('extraction', 'errors_validateField'), {
          fallbackMessage: t('extraction', 'fieldOperationValidateFallback')
    });
  }, [handleError]);

  const handleFieldOperationError = useCallback((
    error: unknown,
    operation: 'create' | 'edit' | 'delete' | 'validate'
  ) => {
      const contextMap: Record<typeof operation, string> = {
          create: t('extraction', 'errors_addField'),
          edit: t('extraction', 'errors_updateField'),
          delete: t('extraction', 'errors_removeField'),
          validate: t('extraction', 'errors_validateField')
      };
      const fallbackMap: Record<typeof operation, string> = {
          create: t('extraction', 'fieldOperationCreateFallback'),
          edit: t('extraction', 'fieldOperationEditFallback'),
          delete: t('extraction', 'fieldOperationDeleteFallback'),
          validate: t('extraction', 'fieldOperationValidateFallback')
    };

    return handleError(error, contextMap[operation], {
        fallbackMessage: fallbackMap[operation]
    });
  }, [handleError]);

  const handlePermissionError = useCallback((operation: string) => {
      const message = t('extraction', 'permissionDeniedOperation');
    toast.error(message);
    return message;
  }, []);

  const handleValidationError = useCallback((error: unknown) => {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'ZodError') {
      const zodError = error as any;
      const firstError = zodError.errors?.[0];
      if (firstError?.message) {
          toast.error(t('extraction', 'errors_validationPrefix').replace('{{message}}', firstError.message));
        return firstError.message;
      }
    }

      return handleError(error, t('extraction', 'validationErrorTitle'), {
          fallbackMessage: t('extraction', 'validationInvalidData')
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
