/**
 * Types for the user feedback system
 */

export type FeedbackType = 'bug' | 'suggestion' | 'question' | 'other';

export type FeedbackSeverity = 'low' | 'medium' | 'high' | 'critical';

export type FeedbackStatus = 'open' | 'in_progress' | 'resolved' | 'wont_fix' | 'duplicate';

export interface ViewportSize {
  width: number;
  height: number;
}

export interface FeedbackReport {
  id: string;
  user_id: string | null;
  type: FeedbackType;
  description: string;
  severity: FeedbackSeverity | null;
  url: string;
  user_agent: string | null;
  viewport_size: ViewportSize | null;
  project_id: string | null;
  article_id: string | null;
  screenshot_url: string | null;
  status: FeedbackStatus;
  priority: number;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedbackFormData {
  type: FeedbackType;
  description: string;
  severity?: FeedbackSeverity;
}

export interface FeedbackContext {
  url: string;
  user_agent: string;
  viewport_size: ViewportSize;
  project_id: string | null;
  article_id: string | null;
}

