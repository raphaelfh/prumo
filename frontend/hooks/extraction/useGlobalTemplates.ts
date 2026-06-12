/**
 * Hook to manage global templates available for import
 *
 * Features:
 * - Load global templates (CHARMS, PICOS, etc.)
 * - Cache of data
 * - Loading states
 * - Error handling
 *
 * @module useGlobalTemplates
 */

import {useEffect, useRef, useState} from 'react';
import {t} from '@/lib/copy';
import {GlobalExtractionTemplate} from '@/types/extraction';
import {loadGlobalTemplates} from '@/services/templateService';

// =================== INTERFACES ===================

export interface GlobalTemplate extends GlobalExtractionTemplate {
  entityTypesCount: number;
}

interface UseGlobalTemplatesReturn {
  templates: GlobalTemplate[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// =================== HOOK ===================

export function useGlobalTemplates(): UseGlobalTemplatesReturn {
  const [templates, setTemplates] = useState<GlobalTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const loadTemplates = async () => {
    if (!isMountedRef.current) return;
    setLoading(true);
    setError(null);

    console.warn('Fetching available global templates...');

    const result = await loadGlobalTemplates();

    if (!isMountedRef.current) return;

    if (!result.ok) {
      console.error('Erro ao carregar templates globais:', result.error);
      setError(result.error.message || t('common', 'errors_unknownError'));
      setTemplates([]);
    } else {
      console.warn(`✅ ${result.data.length} templates globais encontrados`);
      setTemplates(result.data as GlobalTemplate[]);
    }

    if (isMountedRef.current) setLoading(false);
  };

  useEffect(() => {
    isMountedRef.current = true;
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void loadTemplates());

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    templates,
    loading,
    error,
    refresh: loadTemplates
  };
}
