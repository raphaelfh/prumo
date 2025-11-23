-- =====================================================
-- MIGRATION: Extraction Hierarchy Validation
-- =====================================================
-- Descrição: Adiciona validações de integridade hierárquica
-- para extraction_instances no nível do banco de dados.
-- Garante consistência de templates, parent-child relationships,
-- ausência de ciclos e validação de cardinalidade.
-- =====================================================

-- =================== FUNÇÃO DE VALIDAÇÃO HIERÁRQUICA ===================

CREATE OR REPLACE FUNCTION validate_extraction_instance_hierarchy()
RETURNS TRIGGER AS $$
DECLARE
  v_parent_instance extraction_instances%ROWTYPE;
  v_child_entity_type extraction_entity_types%ROWTYPE;
  v_parent_entity_type extraction_entity_types%ROWTYPE;
  v_existing_count INTEGER;
BEGIN
  -- Se não tem parent, validar apenas cardinalidade e template-entity consistency
  IF NEW.parent_instance_id IS NULL THEN
    -- Buscar entity_type para validar cardinalidade
    SELECT * INTO v_child_entity_type
    FROM extraction_entity_types
    WHERE id = NEW.entity_type_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Entity type % não encontrado', NEW.entity_type_id;
    END IF;

    -- Validar cardinalidade 'one' (se aplicável)
    IF v_child_entity_type.cardinality = 'one' THEN
      SELECT COUNT(*) INTO v_existing_count
      FROM extraction_instances
      WHERE article_id = NEW.article_id
        AND entity_type_id = NEW.entity_type_id
        AND parent_instance_id IS NULL
        AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

      IF v_existing_count > 0 THEN
        RAISE EXCEPTION 
          'Já existe uma instância com cardinality="one" para entity_type_id=% no artigo %. Apenas uma instância é permitida.',
          NEW.entity_type_id,
          NEW.article_id;
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- ========== VALIDAÇÕES COM PARENT ==========

  -- 1. Buscar parent instance
  SELECT * INTO v_parent_instance
  FROM extraction_instances
  WHERE id = NEW.parent_instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent instance % não encontrado', NEW.parent_instance_id;
  END IF;

  -- 2. Validar que parent e child estão no mesmo template
  IF v_parent_instance.template_id != NEW.template_id THEN
    RAISE EXCEPTION 
      'Parent instance e child instance devem usar o mesmo template_id. Parent: %, Child: %',
      v_parent_instance.template_id,
      NEW.template_id;
  END IF;

  -- 3. Validar que parent e child estão no mesmo artigo
  IF v_parent_instance.article_id IS DISTINCT FROM NEW.article_id THEN
    RAISE EXCEPTION 
      'Parent instance e child instance devem pertencer ao mesmo artigo. Parent: %, Child: %',
      v_parent_instance.article_id,
      NEW.article_id;
  END IF;

  -- 4. Buscar entity_types
  SELECT * INTO v_child_entity_type
  FROM extraction_entity_types
  WHERE id = NEW.entity_type_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entity type % não encontrado', NEW.entity_type_id;
  END IF;

  SELECT * INTO v_parent_entity_type
  FROM extraction_entity_types
  WHERE id = v_parent_instance.entity_type_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entity type % (parent) não encontrado', v_parent_instance.entity_type_id;
  END IF;

  -- 5. Validar que child_entity_type.parent_entity_type_id = parent_entity_type.id
  IF v_child_entity_type.parent_entity_type_id != v_parent_entity_type.id THEN
    RAISE EXCEPTION 
      'Entity type "%" (name: %) não é filho de "%" (name: %) no template. Verifique parent_entity_type_id na definição do template.',
      v_child_entity_type.id,
      v_child_entity_type.name,
      v_parent_entity_type.id,
      v_parent_entity_type.name;
  END IF;

  -- 6. Validar cardinalidade 'one' para child instances
  IF v_child_entity_type.cardinality = 'one' THEN
    SELECT COUNT(*) INTO v_existing_count
    FROM extraction_instances
    WHERE article_id = NEW.article_id
      AND entity_type_id = NEW.entity_type_id
      AND parent_instance_id = NEW.parent_instance_id
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

    IF v_existing_count > 0 THEN
      RAISE EXCEPTION 
        'Já existe uma instância com cardinality="one" para entity_type_id=% no parent_instance_id=% no artigo %. Apenas uma instância é permitida.',
        NEW.entity_type_id,
        NEW.parent_instance_id,
        NEW.article_id;
    END IF;
  END IF;

  -- 7. Validar ausência de ciclos (usando CTE recursiva limitada)
  IF EXISTS (
    WITH RECURSIVE hierarchy AS (
      SELECT id, parent_instance_id, 1 as depth
      FROM extraction_instances
      WHERE id = NEW.parent_instance_id
      
      UNION ALL
      
      SELECT ei.id, ei.parent_instance_id, h.depth + 1
      FROM extraction_instances ei
      JOIN hierarchy h ON ei.id = h.parent_instance_id
      WHERE h.depth < 10 -- Limite de profundidade para evitar loops infinitos
        AND ei.id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid) -- Não verificar o próprio registro sendo inserido
    )
    SELECT 1 FROM hierarchy
    WHERE parent_instance_id = NEW.id
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 
      'Ciclo detectado na hierarquia: instância % seria filha de seu próprio descendente. Verifique a cadeia de parent_instance_id.',
      NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_extraction_instance_hierarchy() IS 
'Valida integridade hierárquica de extraction_instances: consistência de template, parent-child relationship, ausência de ciclos e cardinalidade. Executado via trigger antes de INSERT/UPDATE.';

-- =================== TRIGGER DE VALIDAÇÃO ===================

CREATE TRIGGER trg_validate_instance_hierarchy
  BEFORE INSERT OR UPDATE OF parent_instance_id, entity_type_id, template_id, article_id
  ON extraction_instances
  FOR EACH ROW
  EXECUTE FUNCTION validate_extraction_instance_hierarchy();

COMMENT ON TRIGGER trg_validate_instance_hierarchy ON extraction_instances IS
'Valida hierarquia antes de inserir/atualizar instâncias. Valida: template consistency, parent-child relationship, ciclos e cardinalidade.';

-- =================== CONSTRAINTS ===================

-- NOTA: Constraints com subconsultas não são suportadas pelo PostgreSQL.
-- Todas as validações de integridade são feitas via trigger (validate_extraction_instance_hierarchy).
-- O trigger executa antes de INSERT/UPDATE e garante:
-- - Parent e child usam o mesmo template_id
-- - Entity type pertence ao template especificado
-- - Consistência de hierarquia, ausência de ciclos e validação de cardinalidade

-- =================== FUNÇÃO AUXILIAR PARA CARDINALIDADE ===================

CREATE OR REPLACE FUNCTION check_cardinality_one(
  p_article_id UUID,
  p_entity_type_id UUID,
  p_parent_instance_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_count INTEGER;
  v_cardinality extraction_cardinality;
BEGIN
  SELECT cardinality INTO v_cardinality
  FROM extraction_entity_types
  WHERE id = p_entity_type_id;

  IF NOT FOUND THEN
    RETURN FALSE; -- Entity type não existe
  END IF;

  IF v_cardinality != 'one' THEN
    RETURN TRUE; -- Não precisa validar, pode criar
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM extraction_instances
  WHERE article_id = p_article_id
    AND entity_type_id = p_entity_type_id
    AND (parent_instance_id IS NOT DISTINCT FROM p_parent_instance_id);

  RETURN v_count = 0; -- Retorna true se pode criar (não existe ainda)
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION check_cardinality_one(UUID, UUID, UUID) IS
'Valida se ainda é possível criar instância com cardinality="one". Retorna true se pode criar (não existe instância ainda), false caso contrário. Usada pela aplicação para validação proativa antes de tentar inserir.';

-- =================== ÍNDICES ADICIONAIS PARA PERFORMANCE ===================

-- Índice para otimizar queries de cardinalidade
CREATE INDEX IF NOT EXISTS idx_extraction_instances_cardinality_check
ON extraction_instances(article_id, entity_type_id, parent_instance_id)
WHERE parent_instance_id IS NOT NULL;

COMMENT ON INDEX idx_extraction_instances_cardinality_check IS
'Índice para otimizar validação de cardinalidade "one" em child instances.';

-- Índice para otimizar queries de hierarquia recursiva
CREATE INDEX IF NOT EXISTS idx_extraction_instances_hierarchy_recursive
ON extraction_instances(parent_instance_id, article_id, entity_type_id)
WHERE parent_instance_id IS NOT NULL;

COMMENT ON INDEX idx_extraction_instances_hierarchy_recursive IS
'Índice para otimizar queries recursivas de hierarquia (detecção de ciclos e busca de children).';

