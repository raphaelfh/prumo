-- =====================================================
-- MIGRATION: Fix Articles RLS Policy
-- =====================================================
-- Descrição: Corrige a política RLS de articles adicionando
-- WITH CHECK para permitir UPDATEs e INSERTs corretamente
-- =====================================================

-- Remover política antiga
DROP POLICY IF EXISTS "Members can manage articles" ON articles;

-- Recriar política com WITH CHECK para UPDATE e INSERT
CREATE POLICY "Members can manage articles"
  ON articles FOR ALL
  USING (is_project_member(project_id, auth.uid()))
  WITH CHECK (is_project_member(project_id, auth.uid()));

COMMENT ON POLICY "Members can manage articles" ON articles IS 
'Permite que membros do projeto façam INSERT, UPDATE e DELETE em artigos. 
WITH CHECK garante que o usuário é membro do projeto tanto na linha existente (USING) 
quanto nos novos valores (WITH CHECK), especialmente importante para UPDATEs.';

