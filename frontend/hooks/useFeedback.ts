/**
 * Hook to manage user feedback submission
 * Automatically captures technical and application context
 */

import {useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/contexts/AuthContext';
import {useToast} from '@/hooks/use-toast';
import {t} from '@/lib/copy';
import type {FeedbackContext, FeedbackFormData} from '@/types/feedback';

/**
 * Captures technical and application context automatically
 */
function getCurrentContext(): FeedbackContext {
  const url = window.location.href;
  const pathname = window.location.pathname;

    // Extract project_id from URL if on /projects/:id
  const projectMatch = pathname.match(/\/projects\/([a-f0-9-]+)/);
  const project_id = projectMatch ? projectMatch[1] : null;

    // Extract article_id from URL (query params or path)
  const urlParams = new URLSearchParams(window.location.search);
  const articleFromQuery = urlParams.get('article');
  const articleMatch = pathname.match(/\/articles\/([a-f0-9-]+)/);
  const article_id = articleFromQuery || (articleMatch ? articleMatch[1] : null);
  
  return {
    url,
    user_agent: navigator.userAgent,
    viewport_size: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    project_id,
    article_id,
  };
}

export function useFeedback() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();

  const submitFeedback = async (data: FeedbackFormData): Promise<boolean> => {
    setSubmitting(true);
    setError(null);

    try {
        // Basic validation
      if (!data.description || data.description.trim().length < 10) {
          throw new Error(t('common', 'feedbackDescriptionMinLength'));
      }

      const context = getCurrentContext();
      
      const { error: insertError } = await supabase
        .from('feedback_reports')
        .insert({
          user_id: user?.id || null,
          type: data.type,
          description: data.description.trim(),
          severity: data.type === 'bug' && data.severity ? data.severity : null,
          url: context.url,
          user_agent: context.user_agent,
          viewport_size: context.viewport_size,
          project_id: context.project_id,
          article_id: context.article_id,
        });

      if (insertError) {
        throw insertError;
      }

      toast({
          title: t('common', 'feedbackSuccessTitle'),
          description: t('common', 'feedbackSuccessDesc'),
      });

      return true;
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : t('common', 'errors_sendFeedbackFailed');
      setError(errorMessage);
      
      toast({
          title: t('common', 'errors_sendFeedbackFailed'),
        description: errorMessage,
        variant: 'destructive',
      });
      
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  return { 
    submitFeedback, 
    submitting, 
    error 
  };
}

