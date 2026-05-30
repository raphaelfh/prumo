/**
 * Hook to submit user feedback to the backend (which forwards to Linear).
 * Captures technical + application context automatically.
 */
import { useMutation } from '@tanstack/react-query';

import { useToast } from '@/hooks/use-toast';
import { t } from '@/lib/copy';
import { FeedbackService } from '@/services/feedbackService';
import type {
  FeedbackAttachmentInput,
  FeedbackContext,
  FeedbackFormData,
  SubmitFeedbackPayload,
} from '@/types/feedback';

declare const __APP_VERSION__: string | undefined;

function getCurrentContext(): FeedbackContext {
  const pathname = window.location.pathname;
  const projectMatch = pathname.match(/\/projects\/([a-f0-9-]+)/);
  const urlParams = new URLSearchParams(window.location.search);
  const articleFromQuery = urlParams.get('article');
  const articleMatch = pathname.match(/\/articles\/([a-f0-9-]+)/);

  return {
    url: window.location.href,
    route: pathname,
    user_agent: navigator.userAgent,
    viewport_size: { width: window.innerWidth, height: window.innerHeight },
    project_id: projectMatch ? projectMatch[1] : null,
    article_id: articleFromQuery || (articleMatch ? articleMatch[1] : null),
    app_version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null,
  };
}

export function useFeedback() {
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (payload: SubmitFeedbackPayload) => FeedbackService.submit(payload),
  });

  const submitFeedback = async (
    data: FeedbackFormData,
    attachments: FeedbackAttachmentInput[] = [],
  ): Promise<boolean> => {
    if (!data.description || data.description.trim().length < 10) {
      toast({
        title: t('common', 'errors_sendFeedbackFailed'),
        description: t('common', 'feedbackDescriptionMinLength'),
        variant: 'destructive',
      });
      return false;
    }

    try {
      await mutation.mutateAsync({
        type: data.type,
        description: data.description.trim(),
        severity: data.type === 'bug' ? data.severity : undefined,
        summary: data.summary,
        context: getCurrentContext(),
        attachments,
      });
      toast({
        title: t('common', 'feedbackSuccessTitle'),
        description: t('navigation', 'feedbackSuccessSent'),
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('common', 'errors_sendFeedbackFailed');
      toast({
        title: t('common', 'errors_sendFeedbackFailed'),
        description: msg,
        variant: 'destructive',
      });
      return false;
    }
  };

  return { submitFeedback, submitting: mutation.isPending, error: mutation.error?.message ?? null };
}
