import {useCallback, useEffect, useMemo, useState} from 'react';
import {articleCache, globalCache} from '@/services/cacheService';

/**
 * Hook otimizado para cache de dados com invalidação inteligente
 * Integra com o sistema de cache centralizado
 */

interface UseOptimizedCacheOptions<T> {
  cacheKey: string;
  fetchFn: () => Promise<T>;
  cache?: typeof globalCache | typeof articleCache;
  ttl?: number;
  staleWhileRevalidate?: boolean;
  enabled?: boolean;
}

interface CacheState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  lastFetch: number | null;
  isStale: boolean;
}

export function useOptimizedCache<T>({
  cacheKey,
  fetchFn,
  cache = globalCache,
  ttl,
  staleWhileRevalidate = true,
  enabled = true,
}: UseOptimizedCacheOptions<T>) {
  const [state, setState] = useState<CacheState<T>>({
    data: null,
    loading: false,
    error: null,
    lastFetch: null,
    isStale: false,
  });

  // Função para buscar dados
  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!enabled) return;

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      let data: T;

      if (forceRefresh) {
        // Buscar dados frescos e atualizar cache
        data = await fetchFn();
        cache.set(cacheKey, data, ttl);
        setState(prev => ({
          ...prev,
          data,
          loading: false,
          lastFetch: Date.now(),
          isStale: false,
        }));
      } else {
        // Usar cache com fallback
        data = await cache.getOrSet(cacheKey, fetchFn, ttl);
        setState(prev => ({
          ...prev,
          data,
          loading: false,
          lastFetch: Date.now(),
          isStale: false,
        }));
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      }));
    }
  }, [cacheKey, fetchFn, cache, ttl, enabled]);

  // Função para invalidar cache
  const invalidate = useCallback(() => {
    cache.delete(cacheKey);
    setState(prev => ({
      ...prev,
      data: null,
      isStale: true,
    }));
  }, [cacheKey, cache]);

  // Função para atualizar dados no cache
  const updateData = useCallback((newData: T) => {
    cache.set(cacheKey, newData, ttl);
    setState(prev => ({
      ...prev,
      data: newData,
      lastFetch: Date.now(),
      isStale: false,
    }));
  }, [cacheKey, cache, ttl]);

  // Função para revalidar dados
  const revalidate = useCallback(() => {
    if (staleWhileRevalidate) {
      // Buscar em background sem mostrar loading
      fetchData(true).catch(() => {
        // Ignorar erros em revalidação em background
      });
    } else {
      fetchData(true);
    }
  }, [fetchData, staleWhileRevalidate]);

  // Buscar dados iniciais
  useEffect(() => {
    if (enabled) {
      fetchData();
    }
  }, [fetchData, enabled]);

  // Verificar se dados estão stale
  useEffect(() => {
    if (!state.lastFetch || !ttl) return;

    const checkStale = () => {
      const isStale = Date.now() - state.lastFetch! > ttl;
      setState(prev => ({ ...prev, isStale }));
    };

    checkStale();
    const interval = setInterval(checkStale, 60000); // Verificar a cada minuto

    return () => clearInterval(interval);
  }, [state.lastFetch, ttl]);

  // Auto-revalidação quando dados ficam stale
  useEffect(() => {
    if (state.isStale && staleWhileRevalidate) {
      revalidate();
    }
  }, [state.isStale, staleWhileRevalidate, revalidate]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    isStale: state.isStale,
    lastFetch: state.lastFetch,
    refetch: fetchData,
    invalidate,
    updateData,
    revalidate,
  };
}

/**
 * Hook para cache de listas com operações otimizadas
 */
export function useOptimizedListCache<T>({
  cacheKey,
  fetchFn,
  cache = globalCache,
  ttl,
  enabled = true,
}: UseOptimizedCacheOptions<T[]>) {
  const cacheResult = useOptimizedCache({
    cacheKey,
    fetchFn,
    cache,
    ttl,
    enabled,
  });

  // Funções específicas para listas
  const addItem = useCallback((item: T) => {
    if (!cacheResult.data) return;
    
    const newData = [...cacheResult.data, item];
    cacheResult.updateData(newData);
  }, [cacheResult]);

  const updateItem = useCallback((index: number, item: T) => {
    if (!cacheResult.data || index < 0 || index >= cacheResult.data.length) return;
    
    const newData = [...cacheResult.data];
    newData[index] = item;
    cacheResult.updateData(newData);
  }, [cacheResult]);

  const removeItem = useCallback((index: number) => {
    if (!cacheResult.data || index < 0 || index >= cacheResult.data.length) return;
    
    const newData = cacheResult.data.filter((_, i) => i !== index);
    cacheResult.updateData(newData);
  }, [cacheResult]);

  const findItem = useCallback((predicate: (item: T) => boolean) => {
    if (!cacheResult.data) return undefined;
    return cacheResult.data.find(predicate);
  }, [cacheResult.data]);

  const filterItems = useCallback((predicate: (item: T) => boolean) => {
    if (!cacheResult.data) return [];
    return cacheResult.data.filter(predicate);
  }, [cacheResult.data]);

  return {
    ...cacheResult,
    addItem,
    updateItem,
    removeItem,
    findItem,
    filterItems,
    length: cacheResult.data?.length || 0,
  };
}

/**
 * Hook para cache de objetos com operações otimizadas
 */
export function useOptimizedObjectCache<T extends Record<string, any>>({
  cacheKey,
  fetchFn,
  cache = globalCache,
  ttl,
  enabled = true,
}: UseOptimizedCacheOptions<T>) {
  const cacheResult = useOptimizedCache({
    cacheKey,
    fetchFn,
    cache,
    ttl,
    enabled,
  });

  // Funções específicas para objetos
  const updateField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    if (!cacheResult.data) return;
    
    const newData = { ...cacheResult.data, [field]: value };
    cacheResult.updateData(newData);
  }, [cacheResult]);

  const updateFields = useCallback((updates: Partial<T>) => {
    if (!cacheResult.data) return;
    
    const newData = { ...cacheResult.data, ...updates };
    cacheResult.updateData(newData);
  }, [cacheResult]);

  const getField = useCallback(<K extends keyof T>(field: K): T[K] | undefined => {
    return cacheResult.data?.[field];
  }, [cacheResult.data]);

  return {
    ...cacheResult,
    updateField,
    updateFields,
    getField,
  };
}

/**
 * Hook para cache de dados com dependências
 */
export function useOptimizedCacheWithDeps<T>(
  cacheKey: string,
  fetchFn: () => Promise<T>,
  deps: React.DependencyList,
  options: Omit<UseOptimizedCacheOptions<T>, 'cacheKey' | 'fetchFn'> = {}
) {
  const memoizedFetchFn = useCallback(fetchFn, deps);
  const memoizedCacheKey = useMemo(() => 
    `${cacheKey}_${JSON.stringify(deps)}`, 
    [cacheKey, deps]
  );

  return useOptimizedCache({
    cacheKey: memoizedCacheKey,
    fetchFn: memoizedFetchFn,
    ...options,
  });
}
