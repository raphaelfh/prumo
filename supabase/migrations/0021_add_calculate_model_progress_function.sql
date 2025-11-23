-- =====================================================
-- MIGRATION: Add calculate_model_progress function
-- =====================================================
-- Descrição: Cria função SQL para calcular progresso de preenchimento
-- de campos de um modelo de predição (incluindo child instances)
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_model_progress(
  p_article_id uuid,
  p_model_id uuid
)
RETURNS TABLE (
  completed_fields integer,
  total_fields integer,
  percentage numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_fields integer := 0;
  v_completed_fields integer := 0;
  v_percentage numeric := 0;
BEGIN
  -- Buscar todos os campos relacionados ao modelo:
  -- 1. Campos do próprio modelo (prediction_models)
  -- 2. Campos de todas as child instances do modelo
  
  WITH model_instances AS (
    -- Incluir o próprio modelo
    SELECT id, entity_type_id
    FROM extraction_instances
    WHERE id = p_model_id
      AND article_id = p_article_id
    
    UNION ALL
    
    -- Incluir todas as child instances do modelo
    SELECT child.id, child.entity_type_id
    FROM extraction_instances child
    WHERE child.parent_instance_id = p_model_id
      AND child.article_id = p_article_id
  ),
  all_fields AS (
    -- Buscar todos os campos das instâncias do modelo
    SELECT DISTINCT ef.id as field_id
    FROM model_instances mi
    INNER JOIN extraction_fields ef ON ef.entity_type_id = mi.entity_type_id
  ),
  completed_fields_count AS (
    -- Contar campos que têm valores preenchidos
    SELECT COUNT(DISTINCT ev.field_id) as count
    FROM all_fields af
    INNER JOIN extracted_values ev ON ev.field_id = af.field_id
    WHERE ev.article_id = p_article_id
      AND ev.instance_id IN (
        SELECT id FROM model_instances
      )
      -- Considerar apenas valores não vazios
      AND ev.value IS NOT NULL
      AND ev.value != 'null'::jsonb
      AND ev.value != '""'::jsonb
      AND ev.value != '{}'::jsonb
  )
  SELECT 
    (SELECT COUNT(*) FROM all_fields)::integer as total,
    COALESCE((SELECT count FROM completed_fields_count), 0)::integer as completed
  INTO v_total_fields, v_completed_fields;

  -- Calcular porcentagem
  IF v_total_fields > 0 THEN
    v_percentage := ROUND((v_completed_fields::numeric / v_total_fields::numeric) * 100, 2);
  ELSE
    v_percentage := 0;
  END IF;

  -- Retornar resultado
  RETURN QUERY SELECT v_completed_fields, v_total_fields, v_percentage;
END;
$$;

COMMENT ON FUNCTION calculate_model_progress IS 'Calcula o progresso de preenchimento de campos de um modelo de predição, incluindo todos os campos do modelo e de suas child instances';

