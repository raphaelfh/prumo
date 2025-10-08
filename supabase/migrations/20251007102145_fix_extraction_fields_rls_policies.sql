-- Migration: Corrigir RLS Policies de extraction_fields
-- Problema: Policies não funcionam para templates de projeto (usam template_id em vez de project_template_id)
-- Data: 2025-10-07

-- ============================================
-- 1. REMOVER POLICIES ANTIGAS (INCORRETAS)
-- ============================================

DROP POLICY IF EXISTS "Members can view fields" ON extraction_fields;
DROP POLICY IF EXISTS "Members can manage project fields" ON extraction_fields;

-- ============================================
-- 2. CRIAR POLICIES CORRETAS
-- ============================================

-- 2.1 SELECT: Membros podem ver campos de templates globais E de seus projetos
CREATE POLICY "members_view_extraction_fields"
ON extraction_fields FOR SELECT
USING (
  EXISTS (
    SELECT 1 
    FROM extraction_entity_types eet
    WHERE eet.id = extraction_fields.entity_type_id
      AND (
        -- Templates globais (públicos)
        (eet.template_id IS NOT NULL)
        OR
        -- Templates de projeto onde é membro
        (
          eet.project_template_id IN (
            SELECT id FROM project_extraction_templates
            WHERE project_id IN (
              SELECT project_id FROM project_members
              WHERE user_id = auth.uid()
            )
          )
        )
      )
  )
);

-- 2.2 INSERT: Apenas managers podem adicionar campos em seus projetos
CREATE POLICY "managers_insert_extraction_fields"
ON extraction_fields FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 
    FROM extraction_entity_types eet
    JOIN project_extraction_templates pet ON eet.project_template_id = pet.id
    JOIN project_members pm ON pm.project_id = pet.project_id
    WHERE eet.id = extraction_fields.entity_type_id
      AND pm.user_id = auth.uid()
      AND pm.role = 'manager'
  )
);

-- 2.3 UPDATE: Apenas managers podem editar campos de seus projetos
CREATE POLICY "managers_update_extraction_fields"
ON extraction_fields FOR UPDATE
USING (
  EXISTS (
    SELECT 1 
    FROM extraction_entity_types eet
    JOIN project_extraction_templates pet ON eet.project_template_id = pet.id
    JOIN project_members pm ON pm.project_id = pet.project_id
    WHERE eet.id = extraction_fields.entity_type_id
      AND pm.user_id = auth.uid()
      AND pm.role = 'manager'
  )
);

-- 2.4 DELETE: Apenas managers podem deletar campos de seus projetos
CREATE POLICY "managers_delete_extraction_fields"
ON extraction_fields FOR DELETE
USING (
  EXISTS (
    SELECT 1 
    FROM extraction_entity_types eet
    JOIN project_extraction_templates pet ON eet.project_template_id = pet.id
    JOIN project_members pm ON pm.project_id = pet.project_id
    WHERE eet.id = extraction_fields.entity_type_id
      AND pm.user_id = auth.uid()
      AND pm.role = 'manager'
  )
);

-- ============================================
-- 3. COMENTÁRIOS
-- ============================================

COMMENT ON POLICY "members_view_extraction_fields" ON extraction_fields IS 
'Permite que membros visualizem campos de templates globais e de templates de seus projetos';

COMMENT ON POLICY "managers_insert_extraction_fields" ON extraction_fields IS 
'Apenas managers podem adicionar novos campos em templates de seus projetos';

COMMENT ON POLICY "managers_update_extraction_fields" ON extraction_fields IS 
'Apenas managers podem editar campos de templates de seus projetos';

COMMENT ON POLICY "managers_delete_extraction_fields" ON extraction_fields IS 
'Apenas managers podem excluir campos de templates de seus projetos';
