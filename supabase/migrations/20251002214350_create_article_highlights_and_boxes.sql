-- Criar tabela article_highlights
CREATE TABLE IF NOT EXISTS public.article_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  selected_text TEXT,
  scaled_position JSONB NOT NULL,
  color JSONB DEFAULT '{"r":255,"g":255,"b":0,"opacity":0.25}',
  author_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Criar tabela article_boxes
CREATE TABLE IF NOT EXISTS public.article_boxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  scaled_position JSONB NOT NULL,
  color JSONB DEFAULT '{"r":255,"g":255,"b":0,"opacity":0.25}',
  author_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Criar índices
CREATE INDEX IF NOT EXISTS idx_highlights_article ON public.article_highlights(article_id);
CREATE INDEX IF NOT EXISTS idx_highlights_page ON public.article_highlights(article_id, page_number);
CREATE INDEX IF NOT EXISTS idx_boxes_article ON public.article_boxes(article_id);
CREATE INDEX IF NOT EXISTS idx_boxes_page ON public.article_boxes(article_id, page_number);

-- Habilitar RLS
ALTER TABLE public.article_highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_boxes ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para article_highlights
CREATE POLICY "Members can view highlights"
ON public.article_highlights FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.articles a
  WHERE a.id = article_highlights.article_id
  AND can_access_article(a.project_id, auth.uid())
));

CREATE POLICY "Members can create highlights"
ON public.article_highlights FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.articles a
    WHERE a.id = article_highlights.article_id
    AND can_access_article(a.project_id, auth.uid())
  )
);

CREATE POLICY "Users can update own highlights"
ON public.article_highlights FOR UPDATE TO authenticated
USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());

CREATE POLICY "Users can delete own highlights"
ON public.article_highlights FOR DELETE TO authenticated
USING (author_id = auth.uid());

-- Políticas RLS para article_boxes
CREATE POLICY "Members can view boxes"
ON public.article_boxes FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.articles a
  WHERE a.id = article_boxes.article_id
  AND can_access_article(a.project_id, auth.uid())
));

CREATE POLICY "Members can create boxes"
ON public.article_boxes FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.articles a
    WHERE a.id = article_boxes.article_id
    AND can_access_article(a.project_id, auth.uid())
  )
);

CREATE POLICY "Users can update own boxes"
ON public.article_boxes FOR UPDATE TO authenticated
USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());

CREATE POLICY "Users can delete own boxes"
ON public.article_boxes FOR DELETE TO authenticated
USING (author_id = auth.uid());
