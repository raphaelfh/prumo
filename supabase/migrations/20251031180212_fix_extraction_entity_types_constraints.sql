-- =====================================================
-- MIGRATION: Corrigir Constraints de extraction_entity_types
-- =====================================================
-- Descrição: 
-- 1. Corrige FK de template_id para apontar diretamente para extraction_templates_global
-- 2. Adiciona constraint XOR entre template_id e project_template_id
-- =====================================================

-- =================== 1. CORRIGIR FOREIGN KEY ===================

-- Verificar qual constraint existe atualmente
DO $$
DECLARE
  current_constraint_name TEXT;
  current_table_name TEXT;
BEGIN
  -- Buscar constraint atual de template_id
  SELECT 
    tc.constraint_name,
    kcu.table_name
  INTO current_constraint_name, current_table_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  WHERE tc.table_name = 'extraction_entity_types'
    AND kcu.column_name = 'template_id'
    AND tc.constraint_type = 'FOREIGN KEY'
  LIMIT 1;

  -- Se existe constraint, remover (para recriar corretamente)
  IF current_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE extraction_entity_types DROP CONSTRAINT IF EXISTS %I CASCADE', current_constraint_name);
    RAISE NOTICE 'Constraint antiga removida: %', current_constraint_name;
  END IF;
END $$;

-- Limpar dados órfãos antes de adicionar constraint
DELETE FROM extraction_entity_types
WHERE template_id IS NOT NULL
  AND template_id NOT IN (SELECT id FROM extraction_templates_global);

-- Adicionar constraint FK correta (remover se já existir)
ALTER TABLE extraction_entity_types
DROP CONSTRAINT IF EXISTS extraction_entity_types_template_id_fkey;

ALTER TABLE extraction_entity_types
ADD CONSTRAINT extraction_entity_types_template_id_fkey
FOREIGN KEY (template_id)
REFERENCES extraction_templates_global(id)
ON DELETE CASCADE;

-- =================== 2. ADICIONAR CONSTRAINT XOR ===================

-- Remover constraint XOR se já existir (para recriar)
ALTER TABLE extraction_entity_types
DROP CONSTRAINT IF EXISTS chk_entity_type_template_xor;

-- Garantir que apenas uma das colunas está preenchida
ALTER TABLE extraction_entity_types
ADD CONSTRAINT chk_entity_type_template_xor
CHECK (
  (template_id IS NOT NULL AND project_template_id IS NULL) OR
  (template_id IS NULL AND project_template_id IS NOT NULL)
);

-- Log de sucesso das constraints
DO $$
BEGIN
  RAISE NOTICE 'Foreign key constraint corrigida: extraction_entity_types.template_id → extraction_templates_global.id';
  RAISE NOTICE 'Constraint XOR adicionada: template_id e project_template_id são mutuamente exclusivos';
END $$;

-- =================== 3. COMENTÁRIOS EXPLICATIVOS ===================

COMMENT ON CONSTRAINT chk_entity_type_template_xor ON extraction_entity_types IS 
'Garante que cada entity_type pertence ou a um template global (template_id) ou a um template de projeto (project_template_id), mas nunca ambos ou nenhum.';

COMMENT ON CONSTRAINT extraction_entity_types_template_id_fkey ON extraction_entity_types IS 
'Foreign key para templates globais. Usado apenas quando entity_type pertence a um template global (CHARMS, PICOS, etc.).';

-- =================== 4. LOG FINAL ===================

DO $$
DECLARE
  fk_exists BOOLEAN;
  xor_exists BOOLEAN;
BEGIN
  -- Verificar se constraints foram criadas
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'extraction_entity_types_template_id_fkey'
      AND table_name = 'extraction_entity_types'
  ) INTO fk_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_entity_type_template_xor'
      AND table_name = 'extraction_entity_types'
  ) INTO xor_exists;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'MIGRATION: Constraints de extraction_entity_types';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'FK template_id → extraction_templates_global: %', 
    CASE WHEN fk_exists THEN 'OK' ELSE 'FALHOU' END;
  RAISE NOTICE 'Constraint XOR (template_id XOR project_template_id): %', 
    CASE WHEN xor_exists THEN 'OK' ELSE 'FALHOU' END;
  RAISE NOTICE '========================================';
END $$;

