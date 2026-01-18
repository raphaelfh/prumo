-- =====================================================
-- MIGRATION: Correções de Integridade e Performance
-- Prioridade 1 e 2
-- Data: 2025-12-15
-- Autor: Review Hub Team
-- =====================================================

-- =====================================================
-- PRIORIDADE 1: UNIQUE CONSTRAINTS (CRÍTICO)
-- =====================================================

-- 1.1 Unique para child instances (com parent)
-- Evita duplicação de seções filhas para o mesmo modelo
-- Ex: Apenas uma "Source of Data" por modelo de predição
CREATE UNIQUE INDEX IF NOT EXISTS idx_extraction_instances_unique_child
ON extraction_instances (article_id, entity_type_id, parent_instance_id)
WHERE article_id IS NOT NULL AND parent_instance_id IS NOT NULL;

COMMENT ON INDEX idx_extraction_instances_unique_child IS 
    'Evita duplicação de seções filhas (source_of_data, participants, etc.) para o mesmo modelo';

-- 1.2 Unique para instâncias root (sem parent) - por label
-- Evita modelos duplicados com mesmo nome
-- Ex: Não pode ter dois "Logistic Regression" no mesmo artigo
CREATE UNIQUE INDEX IF NOT EXISTS idx_extraction_instances_unique_root
ON extraction_instances (article_id, entity_type_id, label)
WHERE article_id IS NOT NULL AND parent_instance_id IS NULL;

COMMENT ON INDEX idx_extraction_instances_unique_root IS 
    'Evita modelos de predição duplicados com mesmo nome para o mesmo artigo';

-- 1.3 Índice composto para extracted_values (query mais comum)
-- Otimiza: SELECT * FROM extracted_values WHERE instance_id = ? AND field_id = ?
CREATE INDEX IF NOT EXISTS idx_extracted_values_instance_field 
ON extracted_values (instance_id, field_id);

COMMENT ON INDEX idx_extracted_values_instance_field IS 
    'Otimiza busca de valores por instância e campo (query mais frequente)';

-- 1.4 Unique para valores de consenso (apenas um por instance/field)
-- Garante integridade: apenas um valor de consenso por campo
CREATE UNIQUE INDEX IF NOT EXISTS idx_extracted_values_unique_consensus
ON extracted_values (instance_id, field_id)
WHERE is_consensus = true;

COMMENT ON INDEX idx_extracted_values_unique_consensus IS 
    'Garante apenas um valor de consenso por campo/instância';

-- 1.5 Unique para valores por reviewer (um valor por reviewer/instance/field)
-- Evita que um reviewer insira múltiplos valores para o mesmo campo
CREATE UNIQUE INDEX IF NOT EXISTS idx_extracted_values_unique_reviewer
ON extracted_values (instance_id, field_id, reviewer_id)
WHERE reviewer_id IS NOT NULL AND is_consensus = false;

COMMENT ON INDEX idx_extracted_values_unique_reviewer IS 
    'Garante apenas um valor por reviewer para cada campo/instância';

-- =====================================================
-- PRIORIDADE 2: MELHORIAS DE SCHEMA
-- =====================================================

-- 2.1 Criar enum para status (se não existir)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'extraction_instance_status') THEN
        CREATE TYPE extraction_instance_status AS ENUM (
            'pending',
            'in_progress', 
            'completed',
            'reviewed',
            'archived'
        );
        
        COMMENT ON TYPE extraction_instance_status IS 
            'Status possíveis para uma instância de extração';
    END IF;
END $$;

-- 2.2 Alterar coluna status para usar enum (com tratamento correto do default)
DO $$
BEGIN
    -- Verificar se a coluna ainda é varchar
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'extraction_instances' 
        AND column_name = 'status' 
        AND data_type = 'character varying'
    ) THEN
        -- 1. Remover o default primeiro
        ALTER TABLE extraction_instances 
            ALTER COLUMN status DROP DEFAULT;
        
        -- 2. Atualizar valores nulos ou inválidos para 'pending'
        UPDATE extraction_instances 
        SET status = 'pending' 
        WHERE status IS NULL 
           OR status NOT IN ('pending', 'in_progress', 'completed', 'reviewed', 'archived');
        
        -- 3. Alterar tipo da coluna
        ALTER TABLE extraction_instances 
            ALTER COLUMN status TYPE extraction_instance_status 
            USING status::extraction_instance_status;
            
        -- 4. Definir novo default com tipo correto
        ALTER TABLE extraction_instances 
            ALTER COLUMN status SET DEFAULT 'pending'::extraction_instance_status;
            
        -- 5. Tornar NOT NULL
        ALTER TABLE extraction_instances 
            ALTER COLUMN status SET NOT NULL;
            
        RAISE NOTICE 'Coluna status convertida para enum extraction_instance_status';
    ELSE
        RAISE NOTICE 'Coluna status já é do tipo correto ou não existe';
    END IF;
END $$;

-- 2.3 Índice para queries de progresso (muito usado no frontend)
-- Otimiza cálculo de progresso de extração por artigo
CREATE INDEX IF NOT EXISTS idx_extraction_instances_progress
ON extraction_instances (article_id, template_id, entity_type_id)
WHERE article_id IS NOT NULL;

-- 2.4 Índice para buscar instâncias por status
CREATE INDEX IF NOT EXISTS idx_extraction_instances_article_status
ON extraction_instances (article_id, status)
WHERE article_id IS NOT NULL;

-- 2.5 Remover policies redundantes (SELECT já coberto por ALL)
-- Políticas ALL já cobrem SELECT, UPDATE, INSERT, DELETE
DROP POLICY IF EXISTS "Members can view extracted values" ON extracted_values;
DROP POLICY IF EXISTS "Members can view instances" ON extraction_instances;

-- 2.6 Adicionar CHECK constraint para metadata (deve ser objeto JSON)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_name = 'chk_extraction_instances_metadata_object'
    ) THEN
        ALTER TABLE extraction_instances
        ADD CONSTRAINT chk_extraction_instances_metadata_object
        CHECK (jsonb_typeof(metadata) = 'object');
        
        RAISE NOTICE 'CHECK constraint para metadata adicionada';
    END IF;
END $$;

-- =====================================================
-- VERIFICAÇÃO FINAL
-- =====================================================
DO $$
DECLARE
    idx_count INT;
BEGIN
    SELECT COUNT(*) INTO idx_count
    FROM pg_indexes 
    WHERE tablename = 'extraction_instances' 
    AND indexname LIKE 'idx_extraction_instances_unique%';
    
    RAISE NOTICE 'Migration concluída. % unique indexes criados para extraction_instances.', idx_count;
END $$;


