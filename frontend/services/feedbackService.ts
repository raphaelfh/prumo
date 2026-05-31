/**
 * Feedback service — submits user feedback to the backend, which persists
 * an outbox row and forwards it to Linear asynchronously.
 */
import { apiClient } from '@/integrations/api';
import type { FeedbackCreated, SubmitFeedbackPayload } from '@/types/feedback';

export const FeedbackService = {
  submit: (payload: SubmitFeedbackPayload) =>
    apiClient<FeedbackCreated>('/api/v1/feedback', {
      method: 'POST',
      body: payload,
    }),
};
