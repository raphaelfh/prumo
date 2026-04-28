/**
 * Hook to load extraction values from other reviewers in the same run.
 *
 * Replaces the legacy `extracted_values` JOIN with a HITL-native read
 * over `extraction_reviewer_states` (current decision per reviewer)
 * joined with `extraction_reviewer_decisions` (the value) and
 * `profiles` (display name + avatar). Used by the comparison UI.
 */

import { useEffect, useState } from 'react';

import { ExtractionValueService } from '@/services/extractionValueService';
import { t } from '@/lib/copy';

export interface OtherExtraction {
  userId: string;
  userName: string;
  userAvatar?: string | null;
  values: Record<string, any>;
  timestamp: Date;
}

interface UseOtherExtractionsProps {
  articleId: string;
  projectId: string;
  templateId?: string;
  currentUserId: string;
  enabled?: boolean;
}

interface UseOtherExtractionsReturn {
  otherExtractions: OtherExtraction[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useOtherExtractions(
  props: UseOtherExtractionsProps,
): UseOtherExtractionsReturn {
  const {
    articleId,
    projectId: _projectId,
    templateId,
    currentUserId,
    enabled = true,
  } = props;

  const [otherExtractions, setOtherExtractions] = useState<OtherExtraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !articleId || !currentUserId) {
      setLoading(false);
      return;
    }
    void loadOtherExtractions();
  }, [articleId, currentUserId, enabled, templateId]);

  const loadOtherExtractions = async () => {
    setLoading(true);
    setError(null);

    try {
      const run = await ExtractionValueService.findActiveRun(
        articleId,
        templateId ?? null,
      );
      if (!run) {
        setOtherExtractions([]);
        return;
      }

      const others = await ExtractionValueService.loadValuesForOthers(
        run.id,
        currentUserId,
      );

      setOtherExtractions(
        others.map((o) => ({
          userId: o.reviewerId,
          userName: o.reviewerName,
          userAvatar: o.reviewerAvatar ?? undefined,
          values: o.values,
          timestamp: o.latestDecidedAt ? new Date(o.latestDecidedAt) : new Date(),
        })),
      );
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

  return { otherExtractions, loading, error, refresh };
}
