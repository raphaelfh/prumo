-- Create storage bucket for article PDFs
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'articles',
  'articles',
  false,
  52428800, -- 50MB
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for articles bucket
CREATE POLICY "Members can view article files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'articles' AND
  EXISTS (
    SELECT 1 FROM article_files af
    JOIN projects p ON p.id = af.project_id
    WHERE af.storage_key = storage.objects.name
    AND EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
    )
  )
);

CREATE POLICY "Members can upload article files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'articles' AND
  auth.uid() IS NOT NULL
);

CREATE POLICY "Members can delete article files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'articles' AND
  EXISTS (
    SELECT 1 FROM article_files af
    JOIN projects p ON p.id = af.project_id
    WHERE af.storage_key = storage.objects.name
    AND EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
    )
  )
);