-- =====================================================
-- MIGRATION: Índices Otimizados para Hierarquia
-- =====================================================
-- Descrição: Adiciona índices para queries hierárquicas
-- e função helper para traversal recursivo
-- =====================================================

-- Índices para queries hierárquicas de entity_types
CREATE INDEX idx_extraction_entity_types_parent 
  ON extraction_entity_types(parent_entity_type_id)
  WHERE parent_entity_type_id IS NOT NULL;

-- Índices para queries hierárquicas de instances
CREATE INDEX idx_extraction_instances_parent 
  ON extraction_instances(parent_instance_id)
  WHERE parent_instance_id IS NOT NULL;

-- Índice composto para buscar children de uma instância
CREATE INDEX idx_extraction_instances_article_entity_parent
  ON extraction_instances(article_id, entity_type_id, parent_instance_id);

-- =====================================================
-- FUNÇÃO HELPER: Obter Children Recursivamente
-- =====================================================

CREATE OR REPLACE FUNCTION get_instance_children(p_parent_id UUID)
RETURNS TABLE (
  id UUID,
  label VARCHAR,
  entity_type_id UUID,
  level INTEGER
) AS $$
  WITH RECURSIVE children AS (
    -- Base case: children diretos
    SELECT 
      id, 
      label, 
      entity_type_id, 
      parent_instance_id, 
      1 as level
    FROM extraction_instances
    WHERE parent_instance_id = p_parent_id
    
    UNION ALL
    
    -- Recursive case: children dos children
    SELECT 
      ei.id, 
      ei.label, 
      ei.entity_type_id, 
      ei.parent_instance_id, 
      c.level + 1
    FROM extraction_instances ei
    JOIN children c ON ei.parent_instance_id = c.id
  )
  SELECT id, label, entity_type_id, level 
  FROM children
  ORDER BY level, label;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION get_instance_children IS 
  'Returns all children of a given instance, recursively, with their nesting level';

-- =====================================================
-- FUNÇÃO HELPER: Obter Path Completo de uma Instância
-- =====================================================

CREATE OR REPLACE FUNCTION get_instance_path(p_instance_id UUID)
RETURNS TEXT AS $$
  WITH RECURSIVE path AS (
    -- Base case: instância atual
    SELECT 
      id, 
      label, 
      parent_instance_id,
      label::TEXT as full_path,
      1 as level
    FROM extraction_instances
    WHERE id = p_instance_id
    
    UNION ALL
    
    -- Recursive case: subir para parent
    SELECT 
      ei.id, 
      ei.label, 
      ei.parent_instance_id,
      ei.label || ' > ' || p.full_path,
      p.level + 1
    FROM extraction_instances ei
    JOIN path p ON ei.id = p.parent_instance_id
  )
  SELECT full_path 
  FROM path
  WHERE parent_instance_id IS NULL
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION get_instance_path IS 
  'Returns full hierarchical path of an instance (e.g., "Model A > Predictors > Age")';


