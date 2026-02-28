-- =====================================================
-- MIGRATION: Storage Bucket for Articles
-- =====================================================
-- Descrição: Cria bucket de storage para arquivos de artigos
-- e suas políticas RLS de acesso
-- =====================================================

-- =================== STORAGE BUCKET ===================

-- Criar bucket para arquivos de artigos
INSERT INTO storage.buckets (id, name, public)
VALUES ('articles',
        'articles',
        false -- Bucket privado, acesso via RLS
       ) ON CONFLICT (id) DO NOTHING;

-- NOTE: Storage policies that reference application tables (article_files, projects)
-- are created in the Alembic initial migration (0001_initial_public_schema.py)
-- because they depend on those tables existing first.

