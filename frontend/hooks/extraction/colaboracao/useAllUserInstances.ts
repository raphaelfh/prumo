/**
 * Hook to fetch instances from ALL users for comparison
 *
 * Fetches only instances for the current article, with real labels.
 * Used to group correctly by label in comparison.
 */

import {useEffect, useRef, useState} from 'react';
import {t} from '@/lib/copy';
import type {ExtractionInstance} from '@/types/extraction';
import {loadAllUserInstancesForArticle} from '@/services/extractionInstanceService';

export interface InstanceWithCreator extends ExtractionInstance {
  created_by: string; // userId do criador
}

interface UseAllUserInstancesProps {
  articleId: string;
  enabled?: boolean;
}

interface UseAllUserInstancesReturn {
  instances: InstanceWithCreator[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAllUserInstances(props: UseAllUserInstancesProps): UseAllUserInstancesReturn {
  const { articleId, enabled = true } = props;

  const [instances, setInstances] = useState<InstanceWithCreator[]>([]);
  // Only show the loader when there is actually something to load.
  const [loading, setLoading] = useState(() => Boolean(enabled && articleId));
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  // Params cleared after mount: stop the loader (during render, not via effect).
  const [prevKey, setPrevKey] = useState({ articleId, enabled });
  if (articleId !== prevKey.articleId || enabled !== prevKey.enabled) {
    setPrevKey({ articleId, enabled });
    if (!enabled || !articleId) setLoading(false);
  }

  const loadInstances = async () => {
    const myGeneration = ++generationRef.current;
    setLoading(true);
    setError(null);

    console.warn('Fetching all-user instances for article:', articleId);

    const doLoad = async () => {
      const result = await loadAllUserInstancesForArticle(articleId);
      if (myGeneration !== generationRef.current) return;
      if (!result.ok) {
        setError(result.error.message || t('extraction', 'errors_loadInstances'));
        return;
      }
      setInstances(result.data as unknown as InstanceWithCreator[]);
      console.warn(`✅ Loaded ${result.data.length} instances from all users`);
    };

    doLoad()
      .catch((err: unknown) => {
        if (myGeneration !== generationRef.current) return;
        console.error('❌ Error loading instances:', err);
        setError(err instanceof Error ? err.message : t('extraction', 'errors_loadInstances'));
      })
      .finally(() => {
        if (myGeneration === generationRef.current) setLoading(false);
      });
  };

  useEffect(() => {
    if (!enabled || !articleId) return;
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void loadInstances());
    return () => {
      generationRef.current += 1;
    };
  }, [articleId, enabled]);

  const refresh = async () => {
    await loadInstances();
  };

  return {
    instances,
    loading,
    error,
    refresh
  };
}
