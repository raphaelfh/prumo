-- =====================================================
-- MIGRATION: Adicionar Foreign Key Constraint Faltante
-- =====================================================
-- Descrição: Adicionar constraint FK em extraction_entity_types.template_id
-- para garantir integridade referencial com extraction_templates_global
-- =====================================================

-- Verificar se já existe constraint (de migrações antigas que podem ter sido aplicadas)
DO $$
BEGIN
  -- Primeiro, limpar dados órfãos (se houver)
  DELETE FROM extraction_entity_types
  WHERE template_id IS NOT NULL
    AND template_id NOT IN (SELECT id FROM extraction_templates_global);
  
  -- Adicionar constraint FK se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'extraction_entity_types_template_id_fkey'
      AND table_name = 'extraction_entity_types'
  ) THEN
    ALTER TABLE extraction_entity_types
    ADD CONSTRAINT extraction_entity_types_template_id_fkey
    FOREIGN KEY (template_id)
    REFERENCES extraction_templates_global(id)
    ON DELETE CASCADE;
    
    RAISE NOTICE 'Foreign key constraint adicionada: extraction_entity_types.template_id → extraction_templates_global.id';
  ELSE
    RAISE NOTICE 'Foreign key constraint já existe';
  END IF;
END $$;

-- Adicionar índice para performance (se não existir)
CREATE INDEX IF NOT EXISTS idx_extraction_entity_types_template
  ON extraction_entity_types(template_id)
  WHERE template_id IS NOT NULL;

-- Log de sucesso
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Foreign key constraint verificada/adicionada';
  RAISE NOTICE 'Integridade referencial garantida';
  RAISE NOTICE '========================================';
END $$;

