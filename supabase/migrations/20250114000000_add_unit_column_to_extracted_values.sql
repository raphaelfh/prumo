-- =====================================================
-- MIGRAÇÃO: Adicionar coluna unit para valores extraídos
-- =====================================================
-- Descrição: Adiciona coluna unit separada na tabela extracted_values
-- para suportar campos numéricos com unidades customizadas.
-- 
-- Data: 2025-01-14
-- Problema: Código tenta salvar/ler unit mas coluna não existe
-- =====================================================

-- =================== ADICIONAR COLUNA ===================

-- Adicionar coluna unit à tabela extracted_values
ALTER TABLE extracted_values 
ADD COLUMN unit VARCHAR(50) DEFAULT NULL;

-- =================== COMENTÁRIOS ===================

COMMENT ON COLUMN extracted_values.unit IS 
'Unidade associada ao valor numérico extraído. Usado para campos do tipo "number" que permitem múltiplas unidades (anos, meses, kg, g, etc.). NULL para campos não-numéricos ou quando não há unidade específica.';

-- =================== NOTAS ===================
-- 
-- Comportamento esperado:
-- 1. Para campos numéricos com unidades: unit armazena a unidade selecionada
-- 2. Para campos não-numéricos: unit é NULL
-- 3. Para campos numéricos sem unidade: unit é NULL
-- 4. O valor numérico continua sendo armazenado em value.value
--
-- Exemplos:
-- - value: {"value": "50"}, unit: "anos" → 50 anos
-- - value: {"value": "2.5"}, unit: "kg" → 2.5 kg  
-- - value: {"value": "Sim"}, unit: NULL → Sim (campo texto)
--
-- =====================================================
