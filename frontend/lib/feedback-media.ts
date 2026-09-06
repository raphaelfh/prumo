/**
 * What the feedback dialog accepts as an attachment.
 *
 * The accepted set is NOT re-typed here: `FeedbackContentType` comes from the
 * generated OpenAPI contract, so this table must name exactly the types the
 * backend accepts or `tsc` fails — adding one on either side without the other
 * is a build error rather than a rejected upload. The `feedback-media` bucket's
 * `allowed_mime_types` is the one copy still coupled by hand (see
 * supabase/migrations/20260905120000_feedback_media_attach_types.sql).
 *
 * The size caps mirror `FEEDBACK_MAX_IMAGE_BYTES` / `FEEDBACK_MAX_VIDEO_BYTES`
 * in the backend settings — checking them here turns a rejected submit into an
 * inline message before the upload burns the user's bandwidth.
 */
import type {components} from '@/types/api/schema';
import type {FeedbackAttachmentKind} from '@/types/feedback';

type FeedbackContentType = components['schemas']['FeedbackAttachmentIn']['content_type'];

export interface FeedbackMediaSpec {
  kind: FeedbackAttachmentKind;
  /**
   * Extension for the stored object. Derived from the MIME type, never from
   * the picked file's name: the name is untrusted text and the object key is
   * a path.
   */
  extension: string;
}

/** Every type the backend accepts — exhaustive by construction. */
const ACCEPTED_TYPES: Readonly<Record<FeedbackContentType, FeedbackMediaSpec>> = {
  'image/png': {kind: 'image', extension: 'png'},
  'image/jpeg': {kind: 'image', extension: 'jpg'},
  'image/webp': {kind: 'image', extension: 'webp'},
  'image/gif': {kind: 'image', extension: 'gif'},
  'video/mp4': {kind: 'video', extension: 'mp4'},
  'video/webm': {kind: 'video', extension: 'webm'},
  'video/quicktime': {kind: 'video', extension: 'mov'},
};

const MAX_BYTES: Readonly<Record<FeedbackAttachmentKind, number>> = {
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
};

/** `accept` attribute for the file input — the same set, no wildcards. */
export const FEEDBACK_MEDIA_ACCEPT = Object.keys(ACCEPTED_TYPES).join(',');

type FeedbackMediaCheck =
  | {ok: true; spec: FeedbackMediaSpec}
  | {ok: false; reason: 'type' | 'size'};

/** Classify a picked file, or say which rule it broke. */
export function checkFeedbackMedia(file: File): FeedbackMediaCheck {
  // `file.type` is whatever the OS reported — a plain string, so the lookup is
  // widened rather than the table, which must stay keyed by the contract type.
  const spec: FeedbackMediaSpec | undefined =
    ACCEPTED_TYPES[file.type as FeedbackContentType];
  if (!spec) return {ok: false, reason: 'type'};
  if (file.size > MAX_BYTES[spec.kind]) return {ok: false, reason: 'size'};
  return {ok: true, spec};
}
