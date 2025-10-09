-- =====================================================
-- Migration: Corrigir RLS de extraction_evidence
-- Data: 2025-10-08
-- Descrição: Atualiza policies de 'public' para 'authenticated'
--            Consistente com outras tabelas de extração
-- =====================================================

-- Dropar policies antigas com role 'public' incorreto
DROP POLICY IF EXISTS "Members can manage evidence" ON extraction_evidence;
DROP POLICY IF EXISTS "Members can view evidence" ON extraction_evidence;

-- Recriar com role 'authenticated' correto
CREATE POLICY "Members can view evidence"
ON extraction_evidence
FOR SELECT
TO authenticated  -- ✅ Corrigido de 'public' para 'authenticated'
USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Members can manage evidence"
ON extraction_evidence
FOR ALL
TO authenticated  -- ✅ Corrigido de 'public' para 'authenticated'
USING (is_project_member(project_id, auth.uid()))
WITH CHECK (is_project_member(project_id, auth.uid()));

-- Comentários explicativos
COMMENT ON POLICY "Members can view evidence" ON extraction_evidence IS
'Permite que membros autenticados do projeto visualizem evidências vinculadas a valores extraídos';

COMMENT ON POLICY "Members can manage evidence" ON extraction_evidence IS
'Permite que membros autenticados do projeto criem, atualizem e deletem evidências';

-- Índice para busca de evidências por target
CREATE INDEX IF NOT EXISTS idx_extraction_evidence_target
ON extraction_evidence(target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_extraction_evidence_article
ON extraction_evidence(article_id);

CREATE INDEX IF NOT EXISTS idx_extraction_evidence_created_by
ON extraction_evidence(created_by);

COMMENT ON INDEX idx_extraction_evidence_target IS
'Índice para buscar evidências vinculadas a valores ou instâncias específicas';

