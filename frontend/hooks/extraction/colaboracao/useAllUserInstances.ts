/**
 * Hook to fetch instances from ALL users for comparison
 *
 * Fetches only instances for the current article, with real labels.
 * Used to group correctly by label in comparison.
 */

import {useEffect, useState} from 'react';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !articleId) {
      setLoading(false);
      return;
    }

    loadInstances();
  }, [articleId, enabled]);

  const loadInstances = async () => {
    setLoading(true);
    setError(null);

    try {
        console.warn('Fetching all-user instances for article:', articleId);

      const { data, error: queryError } = await supabase
        .from('extraction_instances')
        .select('*')
        .eq('article_id', articleId)
        .order('created_at', { ascending: true });

      if (queryError) throw queryError;

      setInstances((data || []) as InstanceWithCreator[]);
        console.warn(`✅ Loaded ${(data || []).length} instances from all users`);

    } catch (err: any) {
        console.error('❌ Error loading instances:', err);
        setError(err.message || t('extraction', 'errors_loadInstances'));
    } finally {
      setLoading(false);
    }
  };

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
