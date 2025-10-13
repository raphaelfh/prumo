-- =====================================================
-- MIGRAÇÃO: Otimização de Cálculo de Progresso de Modelos
-- =====================================================
-- Descrição: Função SQL para calcular progresso de múltiplos
-- modelos em uma única query, eliminando N+1 queries.
--
-- Performance: De 5 queries por modelo → 1 query para todos
-- =====================================================

-- Função para calcular progresso de modelos
CREATE OR REPLACE FUNCTION calculate_models_progress(
  p_article_id UUID,
  p_model_ids UUID[]
)
RETURNS TABLE (
  model_id UUID,
  completed_fields INT,
  total_fields INT,
  percentage INT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH model_children AS (
    -- Buscar child entity types e instances de cada modelo
    SELECT 
      ei.id AS model_id,
      child_ei.id AS child_instance_id,
      child_et.id AS child_entity_type_id
    FROM extraction_instances ei
    CROSS JOIN extraction_entity_types child_et
    LEFT JOIN extraction_instances child_ei 
      ON child_ei.parent_instance_id = ei.id 
      AND child_ei.entity_type_id = child_et.id
      AND child_ei.article_id = p_article_id
    WHERE ei.id = ANY(p_model_ids)
      AND ei.article_id = p_article_id
      AND child_et.parent_entity_type_id = ei.entity_type_id
  ),
  field_stats AS (
    -- Calcular campos por modelo
    SELECT 
      mc.model_id,
      COUNT(DISTINCT ef.id) AS total,
      COUNT(DISTINCT CASE 
        WHEN ev.value IS NOT NULL 
          AND ev.value::text != 'null' 
          AND ev.value::text != '""'
          AND ev.value::text != '{}'
        THEN ef.id 
      END) AS completed
    FROM model_children mc
    CROSS JOIN extraction_fields ef
    LEFT JOIN extracted_values ev 
      ON ev.instance_id = mc.child_instance_id 
      AND ev.field_id = ef.id
    WHERE ef.entity_type_id = mc.child_entity_type_id
    GROUP BY mc.model_id
  )
  SELECT 
    fs.model_id,
    fs.completed::INT AS completed_fields,
    fs.total::INT AS total_fields,
    CASE 
      WHEN fs.total = 0 THEN 0
      ELSE ROUND((fs.completed::NUMERIC / fs.total::NUMERIC) * 100)::INT
    END AS percentage
  FROM field_stats fs;
END;
$$;

-- Comentário explicativo
COMMENT ON FUNCTION calculate_models_progress IS 
'Calcula progresso de extração de múltiplos modelos em uma query otimizada. 
Retorna completed_fields, total_fields e percentage para cada modelo.';

-- Grant para usuários autenticados
GRANT EXECUTE ON FUNCTION calculate_models_progress TO authenticated;

-- =====================================================
-- Função auxiliar para calcular progresso de UM modelo
-- (para compatibilidade com código existente)
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_model_progress(
  p_article_id UUID,
  p_model_id UUID
)
RETURNS TABLE (
  completed_fields INT,
  total_fields INT,
  percentage INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cmp.completed_fields,
    cmp.total_fields,
    cmp.percentage
  FROM calculate_models_progress(p_article_id, ARRAY[p_model_id]) cmp
  WHERE cmp.model_id = p_model_id;
END;
$$;

COMMENT ON FUNCTION calculate_model_progress IS 
'Wrapper conveniente para calcular progresso de um único modelo.';

GRANT EXECUTE ON FUNCTION calculate_model_progress TO authenticated;

