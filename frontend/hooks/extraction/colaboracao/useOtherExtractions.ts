/**
 * Hook to load extractions from other members
 *
 * Fetches values extracted by other users in the same project
 * to allow comparison and consensus detection.
 *
 * @hook
 */

import {useEffect, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {t} from '@/lib/copy';

// =================== INTERFACES ===================

export interface OtherExtraction {
  userId: string;
  userName: string;
  userAvatar?: string;
  values: Record<string, any>; // key: `${instanceId}_${fieldId}`, value: extracted value
  timestamp: Date;
}

interface UseOtherExtractionsProps {
  articleId: string;
  projectId: string;
  currentUserId: string;
  enabled?: boolean;
}

interface UseOtherExtractionsReturn {
  otherExtractions: OtherExtraction[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// =================== HOOK ===================

export function useOtherExtractions(
  props: UseOtherExtractionsProps
): UseOtherExtractionsReturn {
  const { articleId, projectId, currentUserId, enabled = true } = props;

  const [otherExtractions, setOtherExtractions] = useState<OtherExtraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !articleId || !currentUserId) {
      setLoading(false);
      return;
    }

    loadOtherExtractions();
  }, [articleId, currentUserId, enabled]);

  const loadOtherExtractions = async () => {
    setLoading(true);
    setError(null);

    try {
        console.log('Loading other members\' extractions...');

        // Fetch extracted_values from other users
      const { data, error: queryError } = await supabase
        .from('extracted_values')
        .select(`
          *,
          reviewer:reviewer_id (
            id,
            full_name,
            avatar_url
          )
        `)
        .eq('article_id', articleId)
        .neq('reviewer_id', currentUserId);

      if (queryError) throw queryError;

        // Group by user
      const groupedByUser: Record<string, OtherExtraction> = {};

      (data || []).forEach(value => {
        const userId = value.reviewer_id;
        
        if (!groupedByUser[userId]) {
          groupedByUser[userId] = {
            userId,
              userName: value.reviewer?.full_name || 'User',
            userAvatar: value.reviewer?.avatar_url,
            values: {},
            timestamp: new Date(value.updated_at || value.created_at)
          };
        }

          // Add value
        const key = `${value.instance_id}_${value.field_id}`;
        const extractedValue = value.value?.value ?? value.value;
        groupedByUser[userId].values[key] = extractedValue;

          // Update timestamp to latest
        const valueTimestamp = new Date(value.updated_at || value.created_at);
        if (valueTimestamp > groupedByUser[userId].timestamp) {
          groupedByUser[userId].timestamp = valueTimestamp;
        }
      });

      const extractionsList = Object.values(groupedByUser);
      setOtherExtractions(extractionsList);

        console.log(`✅ Loaded extractions from ${extractionsList.length} members`);

    } catch (err: any) {
        console.error('Error loading other extractions:', err);
        setError(err.message || t('extraction', 'errors_loadOtherExtractions'));
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    await loadOtherExtractions();
  };

  return {
    otherExtractions,
    loading,
    error,
    refresh
  };
}

