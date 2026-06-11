/**
 * Hook to fetch instances from ALL users for comparison
 *
 * Fetches only instances for the current article, with real labels.
 * Used to group correctly by label in comparison.
 */

import {useEffect, useRef, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {t} from '@/lib/copy';
import type {ExtractionInstance} from '@/types/extraction';

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

    try {
        console.warn('Fetching all-user instances for article:', articleId);

      const { data, error: queryError } = await supabase
        .from('extraction_instances')
        .select('*')
        .eq('article_id', articleId)
        .order('created_at', { ascending: true });

      if (myGeneration !== generationRef.current) return;
      if (queryError) throw queryError;

      setInstances((data || []) as InstanceWithCreator[]);
        console.warn(`✅ Loaded ${(data || []).length} instances from all users`);

    } catch (err: any) {
      if (myGeneration !== generationRef.current) return;
        console.error('❌ Error loading instances:', err);
        setError(err.message || t('extraction', 'errors_loadInstances'));
    } finally {
      if (myGeneration === generationRef.current) setLoading(false);
    }
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
