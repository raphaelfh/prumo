/**
 * The caller's article progress (R37): the ONE place that derives the progress
 * user id from auth and reads progress. Every progress surface (the extraction
 * dashboard, both worklist tables, the QA dashboard) calls this, never
 * `useArticleExtractionValues` directly.
 *
 * `userId` is `undefined` while auth resolves and `null` once it resolved with
 * no user; both disable the progress query (`isUnavailable`). Use
 * `isSignedOut`, not `isUnavailable`, for "no user": `isUnavailable` is also
 * true when a surface passes no template. This hook orders nothing (R37);
 * `resolveProgressGate` below is the one shared order of the progress steps.
 */
import {useAuth} from '@/contexts/AuthContext';
import {useArticleExtractionValues} from '@/hooks/extraction/useArticleExtractionValues';
import type {ReviewKind} from '@/lib/comparison/permissions';
import type {ArticleProgressData} from '@/services/articleProgressService';

type CallerArticleProgress = {
  valuesByArticle: Map<string, ArticleProgressData>;
  isLoading: boolean;
  isError: boolean;
  isUnavailable: boolean;
  refetch: () => Promise<unknown>;
  userId: string | null | undefined;
  isAuthResolving: boolean;
  isSignedOut: boolean;
};

export function useCallerArticleProgress(
  projectId: string | null | undefined,
  templateId: string | null | undefined,
  kind: ReviewKind = 'extraction',
): CallerArticleProgress {
  const {user, loading} = useAuth();
  const userId = loading ? undefined : (user?.id ?? null);
  return {
    ...useArticleExtractionValues(projectId, templateId, userId, kind),
    userId,
    isAuthResolving: !!loading,
    isSignedOut: !loading && !user,
  };
}

type ProgressRead = {isLoading: boolean; isError: boolean; refetch: () => Promise<unknown>};
type ProgressGate = {state: 'authResolving'} | {state: 'signedOut'} | {state: 'loading'} | {state: 'ready'}
  | {state: 'error'; retry: () => void};

/** The ONE order of the progress steps (R18 steps 5-8; R19 steps 1-3 + the reads half of 4), first match wins:
 * a failed read beats a pending one, which may be paused. `retry` refetches only the read that failed. */
export function resolveProgressGate(
  progress: ProgressRead & Pick<CallerArticleProgress, 'isAuthResolving' | 'isSignedOut'>,
  structure: ProgressRead,
): ProgressGate {
  if (progress.isAuthResolving) return {state: 'authResolving'};
  if (progress.isSignedOut) return {state: 'signedOut'};
  if (progress.isError || structure.isError) {
    const retry = () => {
      if (progress.isError) void progress.refetch();
      if (structure.isError) void structure.refetch();
    };
    return {state: 'error', retry};
  }
  if (progress.isLoading || structure.isLoading) return {state: 'loading'};
  return {state: 'ready'};
}
