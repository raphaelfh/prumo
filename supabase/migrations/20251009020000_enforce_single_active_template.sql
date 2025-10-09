-- =====================================================
-- Migration: Garantir 1 template ativo por projeto
-- Data: 2025-10-09
-- Descrição: Previne problema de múltiplos templates
--            ativos causando perda de dados nas queries
-- =====================================================

-- 1. Desativar templates duplicados (manter apenas o mais recente)
-- Isso é importante para limpar estado atual antes do constraint
WITH ranked_templates AS (
  SELECT 
    id,
    project_id,
    is_active,
    ROW_NUMBER() OVER (
      PARTITION BY project_id 
      ORDER BY created_at DESC
    ) as rn
  FROM project_extraction_templates
  WHERE is_active = true
)
UPDATE project_extraction_templates pet
SET is_active = false
FROM ranked_templates rt
WHERE pet.id = rt.id
  AND rt.rn > 1
  AND rt.is_active = true;

-- 2. Criar índice único para garantir constraint
-- Permite apenas 1 template ativo por projeto
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_template_per_project
ON project_extraction_templates(project_id)
WHERE is_active = true;

-- 3. Comentários explicativos
COMMENT ON INDEX idx_one_active_template_per_project IS
'Constraint que garante que apenas 1 template pode estar ativo por projeto.
Previne problemas de dados "perdidos" quando múltiplos templates existem.
Se tentar ativar outro template, deve primeiro desativar o atual.';

-- 4. Criar função helper para trocar template ativo
CREATE OR REPLACE FUNCTION switch_active_template(
  p_project_id uuid,
  p_new_template_id uuid
) RETURNS void AS $$
BEGIN
  -- Desativar todos os templates do projeto
  UPDATE project_extraction_templates
  SET is_active = false
  WHERE project_id = p_project_id;
  
  -- Ativar o novo template
  UPDATE project_extraction_templates
  SET is_active = true
  WHERE id = p_new_template_id;
  
  RAISE NOTICE 'Template % ativado para projeto %', p_new_template_id, p_project_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Criar função para verificar se há dados extraídos
CREATE OR REPLACE FUNCTION has_extracted_values(
  p_template_id uuid
) RETURNS boolean AS $$
DECLARE
  value_count integer;
BEGIN
  SELECT COUNT(*)
  INTO value_count
  FROM extracted_values ev
  JOIN extraction_instances ei ON ev.instance_id = ei.id
  WHERE ei.template_id = p_template_id;
  
  RETURN value_count > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Criar função para contar valores extraídos por template
CREATE OR REPLACE FUNCTION count_extracted_values(
  p_template_id uuid
) RETURNS integer AS $$
DECLARE
  value_count integer;
BEGIN
  SELECT COUNT(*)
  INTO value_count
  FROM extracted_values ev
  JOIN extraction_instances ei ON ev.instance_id = ei.id
  WHERE ei.template_id = p_template_id;
  
  RETURN value_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Grant permissions
GRANT EXECUTE ON FUNCTION switch_active_template(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION has_extracted_values(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION count_extracted_values(uuid) TO authenticated;

-- 8. Log de sucesso
DO $$
BEGIN
  RAISE NOTICE '✅ Migration concluída: Constraint de template único criado';
  RAISE NOTICE '✅ Funções helper criadas: switch_active_template, has_extracted_values, count_extracted_values';
END $$;


