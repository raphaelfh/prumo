-- =====================================================
-- MIGRATION: Private bucket for in-app feedback media
-- =====================================================
-- Creates the feedback-media storage bucket and scoped
-- RLS policies so authenticated users may upload/read
-- only under their own auth.uid() prefix.
-- The backend reads blobs via service_role (bypasses RLS)
-- to forward screenshots/clips to Linear.
-- =====================================================

-- Private bucket for feedback screenshots/clips. Browser uploads to its
-- own auth.uid() prefix; backend reads via service_role.
insert into storage.buckets (id, name, public)
values ('feedback-media', 'feedback-media', false)
on conflict (id) do nothing;

-- Authenticated users may upload only under their own uid prefix.
create policy "feedback_media_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'feedback-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Authenticated users may read back their own just-uploaded objects
-- (needed for the dialog preview round-trip).
create policy "feedback_media_select_own"
on storage.objects for select to authenticated
using (
  bucket_id = 'feedback-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);
