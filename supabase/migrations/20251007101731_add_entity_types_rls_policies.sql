-- Migration: Adicionar RLS Policies para extraction_entity_types
-- Problema: Usuários não conseguem ver entity types por falta de policies
-- Data: 2025-10-07

-- ============================================
-- 1. POLÍTICAS PARA extraction_entity_types
-- ============================================

-- 1.1 SELECT: Membros podem ver entity types dos templates de seus projetos
CREATE POLICY "members_view_entity_types"
ON extraction_entity_types FOR SELECT
USING (
  -- Entity types vinculados a templates globais (públicos)
  template_id IS NOT NULL
  OR
  -- OU entity types vinculados a templates de projeto onde usuário é membro
  (
    project_template_id IN (
      SELECT id FROM project_extraction_templates
      WHERE project_id IN (
        SELECT project_id FROM project_members
        WHERE user_id = auth.uid()
      )
    )
  )
);

-- 1.2 INSERT: Apenas managers podem criar entity types em seus projetos
CREATE POLICY "managers_insert_entity_types"
ON extraction_entity_types FOR INSERT
WITH CHECK (
  project_template_id IN (
    SELECT id FROM project_extraction_templates
    WHERE project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = auth.uid()
      AND role = 'manager'
    )
  )
);

-- 1.3 UPDATE: Apenas managers podem atualizar entity types
CREATE POLICY "managers_update_entity_types"
ON extraction_entity_types FOR UPDATE
USING (
  project_template_id IN (
    SELECT id FROM project_extraction_templates
    WHERE project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = auth.uid()
      AND role = 'manager'
    )
  )
);

-- 1.4 DELETE: Apenas managers podem deletar entity types
CREATE POLICY "managers_delete_entity_types"
ON extraction_entity_types FOR DELETE
USING (
  project_template_id IN (
    SELECT id FROM project_extraction_templates
    WHERE project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = auth.uid()
      AND role = 'manager'
    )
  )
);

-- ============================================
-- 2. COMENTÁRIOS
-- ============================================

COMMENT ON POLICY "members_view_entity_types" ON extraction_entity_types IS 
'Permite que membros visualizem entity types de templates globais e de seus projetos';

COMMENT ON POLICY "managers_insert_entity_types" ON extraction_entity_types IS 
'Apenas managers podem criar novos entity types em templates de seus projetos';

COMMENT ON POLICY "managers_update_entity_types" ON extraction_entity_types IS 
'Apenas managers podem editar entity types de templates de seus projetos';

COMMENT ON POLICY "managers_delete_entity_types" ON extraction_entity_types IS 
'Apenas managers podem excluir entity types de templates de seus projetos';
