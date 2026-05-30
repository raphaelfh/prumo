export type FeedbackType = 'bug' | 'suggestion' | 'question' | 'other';
export type FeedbackSeverity = 'low' | 'medium' | 'high' | 'critical';
export type FeedbackAttachmentKind = 'image' | 'video';

export interface ViewportSize {
  width: number;
  height: number;
}

export interface FeedbackContext {
  url: string | null;
  route: string | null;
  user_agent: string | null;
  viewport_size: ViewportSize | null;
  project_id: string | null;
  article_id: string | null;
  app_version: string | null;
}

export interface FeedbackAttachmentInput {
  kind: FeedbackAttachmentKind;
  storage_key: string;
  content_type: string;
  size_bytes: number;
}

export interface FeedbackFormData {
  type: FeedbackType;
  description: string;
  severity?: FeedbackSeverity;
  summary?: string;
}

export interface SubmitFeedbackPayload extends FeedbackFormData {
  context: FeedbackContext;
  attachments: FeedbackAttachmentInput[];
}

export interface FeedbackCreated {
  report_id: string;
}
