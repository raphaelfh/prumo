-- =====================================================
-- MIGRATION: Storage Bucket for Articles
-- =====================================================
-- Descrição: Cria bucket de storage para arquivos de artigos
-- e suas políticas RLS de acesso
-- =====================================================

-- =================== STORAGE BUCKET ===================

-- Criar bucket para arquivos de artigos
INSERT INTO storage.buckets (id, name, public)
VALUES (
  'articles',
  'articles',
  false  -- Bucket privado, acesso via RLS
)
ON CONFLICT (id) DO NOTHING;

-- =================== STORAGE POLICIES ===================

-- Política: Membros podem visualizar arquivos de artigos
-- Apenas se forem membros do projeto ao qual o artigo pertence
CREATE POLICY "Members can view article files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'articles' AND
  EXISTS (
    SELECT 1 FROM article_files af
    JOIN projects p ON p.id = af.project_id
    WHERE af.storage_key = storage.objects.name
    AND is_project_member(p.id, auth.uid())
  )
);

-- Política: Usuários autenticados podem fazer upload de arquivos
-- Restrição adicional: apenas usuários autenticados
CREATE POLICY "Authenticated users can upload article files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'articles' AND
  auth.uid() IS NOT NULL
);

-- Política: Membros podem atualizar arquivos de artigos
-- Apenas se forem membros do projeto ao qual o artigo pertence
CREATE POLICY "Members can update article files"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'articles' AND
  EXISTS (
    SELECT 1 FROM article_files af
    JOIN projects p ON p.id = af.project_id
    WHERE af.storage_key = storage.objects.name
    AND is_project_member(p.id, auth.uid())
  )
);

-- Política: Membros podem deletar arquivos de artigos
-- Apenas se forem membros do projeto ao qual o artigo pertence
CREATE POLICY "Members can delete article files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'articles' AND
  EXISTS (
    SELECT 1 FROM article_files af
    JOIN projects p ON p.id = af.project_id
    WHERE af.storage_key = storage.objects.name
    AND is_project_member(p.id, auth.uid())
  )
);

