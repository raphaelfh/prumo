-- Create enums for annotation types and status
CREATE TYPE annotation_type AS ENUM ('text', 'area');
CREATE TYPE annotation_status AS ENUM ('active', 'deleted');

-- Create article_annotations table
CREATE TABLE IF NOT EXISTS public.article_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  type annotation_type NOT NULL,
  scaled_position JSONB NOT NULL,
  comment_text TEXT,
  color JSONB DEFAULT '{"r":255,"g":255,"b":0,"opacity":0.25}',
  author_id UUID REFERENCES auth.users(id),
  status annotation_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create article_pdf_versions table (optional, for export history)
CREATE TABLE IF NOT EXISTS public.article_pdf_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  version_name TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ann_article ON public.article_annotations(article_id);
CREATE INDEX IF NOT EXISTS idx_ann_article_status ON public.article_annotations(article_id, status);
CREATE INDEX IF NOT EXISTS idx_ann_page ON public.article_annotations(article_id, page_number);
CREATE INDEX IF NOT EXISTS idx_pdf_versions_article ON public.article_pdf_versions(article_id);

-- Enable RLS
ALTER TABLE public.article_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_pdf_versions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for article_annotations
CREATE POLICY "Members can view annotations"
ON public.article_annotations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.articles a
    WHERE a.id = article_annotations.article_id
    AND can_access_article(a.project_id, auth.uid())
  )
);

CREATE POLICY "Members can create annotations"
ON public.article_annotations
FOR INSERT
TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.articles a
    WHERE a.id = article_annotations.article_id
    AND can_access_article(a.project_id, auth.uid())
  )
);

CREATE POLICY "Users can update own annotations"
ON public.article_annotations
FOR UPDATE
TO authenticated
USING (author_id = auth.uid())
WITH CHECK (author_id = auth.uid());

CREATE POLICY "Users can delete own annotations"
ON public.article_annotations
FOR DELETE
TO authenticated
USING (author_id = auth.uid());

-- RLS Policies for article_pdf_versions
CREATE POLICY "Members can view PDF versions"
ON public.article_pdf_versions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.articles a
    WHERE a.id = article_pdf_versions.article_id
    AND can_access_article(a.project_id, auth.uid())
  )
);

CREATE POLICY "Members can create PDF versions"
ON public.article_pdf_versions
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.articles a
    WHERE a.id = article_pdf_versions.article_id
    AND can_access_article(a.project_id, auth.uid())
  )
);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_annotation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_article_annotations_updated_at
BEFORE UPDATE ON public.article_annotations
FOR EACH ROW
EXECUTE FUNCTION update_annotation_updated_at();