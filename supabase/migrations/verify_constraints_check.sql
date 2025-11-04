-- =====================================================
-- SCRIPT DE VERIFICAÇÃO: Constraints de extraction_entity_types
-- =====================================================
-- Execute este script para verificar se a migration
-- 20251031180212_fix_extraction_entity_types_constraints.sql
-- foi aplicada corretamente
-- =====================================================

-- =================== 1. VERIFICAR FOREIGN KEY ===================

SELECT 
    'Foreign Key Verification' AS check_type,
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name,
    ccu.table_name AS referenced_table,
    ccu.column_name AS referenced_column,
    CASE 
        WHEN tc.constraint_name = 'extraction_entity_types_template_id_fkey' 
        AND ccu.table_name = 'extraction_templates_global'
        AND ccu.column_name = 'id'
        THEN '✅ CORRETO'
        ELSE '❌ INCORRETO'
    END AS status
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
LEFT JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
    AND tc.table_schema = ccu.table_schema
WHERE tc.table_name = 'extraction_entity_types'
    AND tc.table_schema = 'public'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'template_id';

-- =================== 2. VERIFICAR CONSTRAINT XOR ===================

SELECT 
    'XOR Constraint Verification' AS check_type,
    tc.constraint_name,
    tc.constraint_type,
    CASE 
        WHEN tc.constraint_name = 'chk_entity_type_template_xor' 
        THEN '✅ EXISTE'
        ELSE '❌ NÃO ENCONTRADO'
    END AS status,
    pg_get_constraintdef(pgc.oid) AS constraint_definition
FROM information_schema.table_constraints tc
JOIN pg_constraint pgc ON pgc.conname = tc.constraint_name
WHERE tc.table_name = 'extraction_entity_types'
    AND tc.table_schema = 'public'
    AND tc.constraint_type = 'CHECK'
    AND tc.constraint_name = 'chk_entity_type_template_xor';

-- =================== 3. VERIFICAR DADOS (INTEGRIDADE) ===================

SELECT 
    'Data Integrity Check' AS check_type,
    COUNT(*) AS total_entity_types,
    COUNT(*) FILTER (WHERE template_id IS NOT NULL AND project_template_id IS NULL) AS only_template_id,
    COUNT(*) FILTER (WHERE template_id IS NULL AND project_template_id IS NOT NULL) AS only_project_template_id,
    COUNT(*) FILTER (WHERE template_id IS NOT NULL AND project_template_id IS NOT NULL) AS both_filled,
    COUNT(*) FILTER (WHERE template_id IS NULL AND project_template_id IS NULL) AS both_null,
    CASE 
        WHEN COUNT(*) FILTER (WHERE template_id IS NOT NULL AND project_template_id IS NOT NULL) > 0 
        THEN '❌ DADOS VIOLANDO CONSTRAINT XOR'
        WHEN COUNT(*) FILTER (WHERE template_id IS NULL AND project_template_id IS NULL) > 0
        THEN '❌ DADOS SEM NENHUMA REFERÊNCIA'
        ELSE '✅ DADOS VÁLIDOS'
    END AS data_status
FROM extraction_entity_types;

-- =================== 4. VERIFICAR ÓRFÃOS ===================

SELECT 
    'Orphan Data Check' AS check_type,
    COUNT(*) AS orphan_template_id,
    CASE 
        WHEN COUNT(*) > 0 
        THEN '❌ EXISTEM REGISTROS ÓRFÃOS'
        ELSE '✅ SEM REGISTROS ÓRFÃOS'
    END AS status
FROM extraction_entity_types eet
WHERE eet.template_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM extraction_templates_global etg 
        WHERE etg.id = eet.template_id
    );

-- =================== 5. RESUMO GERAL ===================

SELECT 
    'Migration Status Summary' AS summary,
    EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'extraction_entity_types_template_id_fkey'
            AND table_name = 'extraction_entity_types'
    ) AS fk_exists,
    EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'chk_entity_type_template_xor'
            AND table_name = 'extraction_entity_types'
    ) AS xor_exists,
    NOT EXISTS (
        SELECT 1 FROM extraction_entity_types
        WHERE (template_id IS NOT NULL AND project_template_id IS NOT NULL)
           OR (template_id IS NULL AND project_template_id IS NULL)
    ) AS data_valid,
    NOT EXISTS (
        SELECT 1 FROM extraction_entity_types eet
        WHERE eet.template_id IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM extraction_templates_global etg 
                WHERE etg.id = eet.template_id
            )
    ) AS no_orphans;

