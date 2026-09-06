/**
 * Feedback service — submits user feedback to the backend, which persists
 * an outbox row and forwards it to Linear asynchronously, and uploads the
 * optional media attachment to the private feedback-media bucket.
 */
import {apiClient} from '@/integrations/api';
import {supabase} from '@/integrations/supabase/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {FeedbackMediaSpec} from '@/lib/feedback-media';
import type {FeedbackAttachmentInput, FeedbackCreated, SubmitFeedbackPayload} from '@/types/feedback';

const MEDIA_BUCKET = 'feedback-media';

export const FeedbackService = {
  submit: (payload: SubmitFeedbackPayload) =>
    apiClient<FeedbackCreated>('/api/v1/feedback', {
      method: 'POST',
      body: payload,
    }),

  /**
   * Store one media file and describe it for the submit payload. The object
   * name is a UUID under the caller's own uid prefix — the bucket's RLS
   * policy allows no other prefix, and the backend re-checks it.
   */
  uploadAttachment: (
    file: File,
    userId: string,
    spec: FeedbackMediaSpec,
  ): Promise<ErrorResult<FeedbackAttachmentInput>> =>
    toResult(async () => {
      const storageKey = `${userId}/${crypto.randomUUID()}.${spec.extension}`;
      const {error} = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(storageKey, file, {contentType: file.type});
      if (error) throw new Error(error.message);
      return {
        kind: spec.kind,
        storage_key: storageKey,
        content_type: file.type,
        size_bytes: file.size,
      };
    }, 'FeedbackService.uploadAttachment'),
};
