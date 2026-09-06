-- =====================================================
-- MIGRATION: Widen feedback-media to attachable formats
-- =====================================================
-- The feedback dialog no longer records the screen; it takes an
-- image or video the user picks from disk. The bucket's original
-- allow-list only covered what getDisplayMedia produced
-- (image/webp, video/webm), so an ordinary screen recording
-- (MP4/MOV) or an animated GIF was rejected at upload.
--
-- Kept in lockstep with _ALLOWED_CONTENT_TYPES in
-- backend/app/schemas/feedback.py and ACCEPTED_TYPES in
-- frontend/lib/feedback-media.ts.
--
-- Size limit and RLS policies are unchanged: 50 MB, uploads and
-- reads confined to the caller's own auth.uid() prefix.
-- =====================================================

update storage.buckets
set allowed_mime_types = array[
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime'
]
where id = 'feedback-media';
