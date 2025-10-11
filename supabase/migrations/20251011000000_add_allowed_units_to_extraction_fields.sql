-- =====================================================
-- MIGRAÇÃO: Adicionar allowed_units para campos numéricos
-- =====================================================
-- Descrição: Permite que managers configurem unidades alternativas
-- customizadas para campos numéricos, ao invés de depender apenas
-- do dicionário automático hardcoded.
-- 
-- Data: 2025-10-11
-- =====================================================

-- =================== ADICIONAR COLUNA ===================

-- Adicionar coluna allowed_units à tabela extraction_fields
ALTER TABLE extraction_fields 
ADD COLUMN allowed_units JSONB DEFAULT NULL;

-- =================== CONSTRAINTS ===================

-- Constraint: se field_type = 'number' e allowed_units não é null, 
-- deve ser array com pelo menos 1 item
-- Se field_type != 'number', allowed_units deve ser NULL
ALTER TABLE extraction_fields
ADD CONSTRAINT chk_field_allowed_units CHECK (
  (field_type = 'number' AND (
    allowed_units IS NULL OR 
    (jsonb_typeof(allowed_units) = 'array' AND jsonb_array_length(allowed_units) >= 1)
  )) OR
  (field_type != 'number' AND allowed_units IS NULL)
);

-- =================== ÍNDICE ===================

-- Índice GIN para consultas em allowed_units (opcional mas recomendado)
CREATE INDEX idx_extraction_fields_allowed_units_gin 
ON extraction_fields USING GIN (allowed_units)
WHERE allowed_units IS NOT NULL;

-- =================== COMENTÁRIOS ===================

COMMENT ON COLUMN extraction_fields.allowed_units IS 
'Array de unidades alternativas permitidas para campos numéricos. Se NULL, o sistema usa o dicionário automático getRelatedUnits(). A primeira unidade do array é considerada a unidade padrão/sugerida.';

-- =================== NOTAS ===================
-- 
-- Comportamento esperado:
-- 1. Se allowed_units IS NULL → usa getRelatedUnits(unit) como fallback
-- 2. Se allowed_units IS NOT NULL → usa array customizado (ignora dicionário)
-- 3. A primeira unidade em allowed_units é a unidade padrão sugerida na UI
-- 4. Retrocompatível: campos existentes continuam funcionando normalmente
--
-- Exemplos de uso:
-- - allowed_units: ["anos", "meses", "semanas"] → revisor escolhe entre estas 3
-- - allowed_units: ["kg", "g", "mg", "lb"] → permite conversões customizadas
-- - allowed_units: ["ciclos"] → unidade única customizada não prevista no dicionário
-- - allowed_units: NULL → usa dicionário automático baseado em 'unit'
--
-- =====================================================


