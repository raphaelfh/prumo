-- =====================================================
-- MIGRATION: Assessment Compatibility View
-- =====================================================
-- Descrição: Cria view de compatibilidade para a tabela
-- assessments legada, permitindo que código antigo continue
-- funcionando enquanto a migração para a nova estrutura
-- (assessment_instances + assessment_responses) ocorre.
--
-- A view agrega assessment_responses de volta para o
-- formato JSONB flat usado pela tabela assessments.
--
-- Estratégia: Soft deprecation
-- - assessments legada: rename para assessments_legacy
-- - assessments view: emula tabela antiga (read-only)
-- - Código novo: usa assessment_instances/responses
-- - Código antigo: continua usando "assessments" (view)
-- =====================================================

-- =================== STEP 1: BACKUP DA TABELA ANTIGA ===================

-- Renomear tabela antiga para _legacy (preservar dados)
ALTER TABLE IF EXISTS assessments RENAME TO assessments_legacy;

COMMENT ON TABLE assessments_legacy IS
'Tabela legada de assessments (deprecated). Use assessment_instances + assessment_responses.
Mantida apenas para referência histórica e rollback se necessário.';

-- =================== STEP 2: CREATE COMPATIBILITY VIEW ===================

CREATE OR REPLACE VIEW assessments AS
SELECT
  ai.id,
  ai.project_id,
  ai.article_id,
  ai.reviewer_id AS user_id,
  i.tool_type,
  ai.instrument_id,
  ai.extraction_instance_id,

  -- Agregar responses de volta em JSONB (formato legado)
  -- key: item_code, value: { level, notes, confidence }
  COALESCE(
    (
      SELECT jsonb_object_agg(
        item.item_code,
        jsonb_build_object(
          'level', ar.selected_level,
          'notes', ar.notes,
          'confidence', ar.confidence,
          'source', ar.source::text,
          'ai_suggestion_id', ar.ai_suggestion_id
        )
      )
      FROM assessment_responses ar
      JOIN assessment_items item ON item.id = ar.assessment_item_id
      WHERE ar.assessment_instance_id = ai.id
    ),
    '{}'::jsonb
  ) AS responses,

  -- Overall assessment extraído de metadata
  CASE
    WHEN ai.metadata ? 'overall_risk' OR ai.metadata ? 'summary' THEN
      jsonb_build_object(
        'overall_risk', ai.metadata->>'overall_risk',
        'summary', ai.metadata->>'summary',
        'applicability', ai.metadata->>'applicability'
      )
    ELSE
      NULL
  END AS overall_assessment,

  -- Confidence level (deprecated, mas mantido para compatibilidade)
  NULL::integer AS confidence_level,

  -- Status
  ai.status,

  -- Completion percentage (calculado via função SQL)
  (
    SELECT completion_percentage
    FROM calculate_assessment_instance_progress(ai.id)
    LIMIT 1
  ) AS completion_percentage,

  -- Versionamento (mantido em 1 para compatibilidade)
  1 AS version,
  true AS is_current_version,

  -- Parent assessment (não usado no novo modelo)
  NULL::uuid AS parent_assessment_id,

  -- Modo cego
  ai.is_blind,
  ai.can_see_others,

  -- Comments (extraído de metadata)
  COALESCE(ai.metadata->'comments', '[]'::jsonb) AS comments,

  -- Private notes (extraído de metadata)
  ai.metadata->>'private_notes' AS private_notes,

  -- Assessed by type (inferido do source das responses)
  CASE
    WHEN EXISTS (
      SELECT 1 FROM assessment_responses ar
      WHERE ar.assessment_instance_id = ai.id
        AND ar.source = 'ai'
    ) THEN 'ai'
    ELSE 'human'
  END AS assessed_by_type,

  -- Run ID (não usado no novo modelo)
  NULL::uuid AS run_id,

  -- Row version
  1 AS row_version,

  -- Timestamps
  ai.created_at,
  ai.updated_at

FROM assessment_instances ai
JOIN assessment_instruments i ON i.id = ai.instrument_id;

COMMENT ON VIEW assessments IS
'View de compatibilidade para tabela assessments legada.
Emula estrutura antiga agregando assessment_responses em JSONB.
READ-ONLY: Inserções devem usar assessment_instances/responses.
Esta view será removida em versão futura (v2.0).';

-- =================== STEP 3: CREATE INSTEAD OF TRIGGERS ===================

-- Trigger para INSERT (redirecionar para novas tabelas)
CREATE OR REPLACE FUNCTION assessments_insert_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_instance_id uuid;
  v_item RECORD;
  v_response_data jsonb;
BEGIN
  -- Criar assessment_instance
  INSERT INTO assessment_instances (
    project_id,
    article_id,
    instrument_id,
    extraction_instance_id,
    label,
    status,
    reviewer_id,
    is_blind,
    can_see_others,
    metadata
  )
  VALUES (
    NEW.project_id,
    NEW.article_id,
    NEW.instrument_id,
    NEW.extraction_instance_id,
    COALESCE(NEW.tool_type || ' Assessment', 'Assessment'),
    COALESCE(NEW.status, 'in_progress'),
    NEW.user_id,
    COALESCE(NEW.is_blind, false),
    COALESCE(NEW.can_see_others, true),
    jsonb_build_object(
      'overall_assessment', NEW.overall_assessment,
      'comments', COALESCE(NEW.comments, '[]'::jsonb),
      'private_notes', NEW.private_notes
    )
  )
  RETURNING id INTO v_instance_id;

  -- Criar assessment_responses a partir do JSONB responses
  FOR v_item IN
    SELECT
      key AS item_code,
      value AS response_value
    FROM jsonb_each(COALESCE(NEW.responses, '{}'::jsonb))
  LOOP
    -- Buscar assessment_item_id pelo item_code
    INSERT INTO assessment_responses (
      project_id,
      article_id,
      assessment_instance_id,
      assessment_item_id,
      selected_level,
      notes,
      confidence,
      source,
      reviewer_id
    )
    SELECT
      NEW.project_id,
      NEW.article_id,
      v_instance_id,
      ai.id,
      v_item.response_value->>'level',
      v_item.response_value->>'notes',
      (v_item.response_value->>'confidence')::numeric,
      COALESCE((v_item.response_value->>'source')::assessment_source, 'human'),
      NEW.user_id
    FROM assessment_items ai
    WHERE ai.item_code = v_item.item_code
      AND ai.instrument_id = NEW.instrument_id;
  END LOOP;

  -- Retornar NEW para satisfazer trigger
  NEW.id := v_instance_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assessments_instead_of_insert
  INSTEAD OF INSERT ON assessments
  FOR EACH ROW
  EXECUTE FUNCTION assessments_insert_trigger();

COMMENT ON FUNCTION assessments_insert_trigger() IS
'Trigger para redirecionar INSERTs na view assessments para as novas tabelas.
Cria assessment_instance + assessment_responses a partir do formato legado.';

-- Trigger para UPDATE (redirecionar para novas tabelas)
CREATE OR REPLACE FUNCTION assessments_update_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
BEGIN
  -- Atualizar assessment_instance
  UPDATE assessment_instances
  SET
    status = COALESCE(NEW.status, status),
    is_blind = COALESCE(NEW.is_blind, is_blind),
    can_see_others = COALESCE(NEW.can_see_others, can_see_others),
    metadata = metadata ||
      jsonb_build_object(
        'overall_assessment', NEW.overall_assessment,
        'comments', COALESCE(NEW.comments, '[]'::jsonb),
        'private_notes', NEW.private_notes
      ),
    updated_at = NOW()
  WHERE id = OLD.id;

  -- Atualizar responses (se fornecido)
  IF NEW.responses IS NOT NULL AND NEW.responses != OLD.responses THEN
    -- Deletar responses antigas
    DELETE FROM assessment_responses
    WHERE assessment_instance_id = OLD.id;

    -- Inserir responses novas
    FOR v_item IN
      SELECT
        key AS item_code,
        value AS response_value
      FROM jsonb_each(NEW.responses)
    LOOP
      INSERT INTO assessment_responses (
        project_id,
        article_id,
        assessment_instance_id,
        assessment_item_id,
        selected_level,
        notes,
        confidence,
        source,
        reviewer_id
      )
      SELECT
        NEW.project_id,
        NEW.article_id,
        OLD.id,
        ai.id,
        v_item.response_value->>'level',
        v_item.response_value->>'notes',
        (v_item.response_value->>'confidence')::numeric,
        COALESCE((v_item.response_value->>'source')::assessment_source, 'human'),
        NEW.user_id
      FROM assessment_items ai
      WHERE ai.item_code = v_item.item_code
        AND ai.instrument_id = NEW.instrument_id;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assessments_instead_of_update
  INSTEAD OF UPDATE ON assessments
  FOR EACH ROW
  EXECUTE FUNCTION assessments_update_trigger();

COMMENT ON FUNCTION assessments_update_trigger() IS
'Trigger para redirecionar UPDATEs na view assessments para as novas tabelas.
Atualiza assessment_instance e recria assessment_responses.';

-- Trigger para DELETE (redirecionar para novas tabelas)
CREATE OR REPLACE FUNCTION assessments_delete_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- Deletar assessment_instance (responses serão deletadas por CASCADE)
  DELETE FROM assessment_instances
  WHERE id = OLD.id;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assessments_instead_of_delete
  INSTEAD OF DELETE ON assessments
  FOR EACH ROW
  EXECUTE FUNCTION assessments_delete_trigger();

COMMENT ON FUNCTION assessments_delete_trigger() IS
'Trigger para redirecionar DELETEs na view assessments para assessment_instances.
Responses são deletadas automaticamente via CASCADE.';

-- =================== STEP 4: GRANT PERMISSIONS ===================

-- Garantir que view tem mesmas permissões que tabela antiga
GRANT SELECT, INSERT, UPDATE, DELETE ON assessments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON assessments TO service_role;

-- =================== STEP 5: CREATE DEPRECATION WARNING FUNCTION ===================

-- Função para logar uso da view legada (monitorar migração)
CREATE OR REPLACE FUNCTION log_assessment_legacy_usage()
RETURNS TRIGGER AS $$
BEGIN
  RAISE WARNING 'DEPRECATED: Tabela "assessments" é legada. Use "assessment_instances" + "assessment_responses" em vez disso. Operation: %, User: %',
    TG_OP,
    current_user;

  RETURN CASE TG_OP
    WHEN 'DELETE' THEN OLD
    ELSE NEW
  END;
END;
$$ LANGUAGE plpgsql;

-- Aplicar warning trigger na view (apenas em development)
-- Comentado para não poluir logs em produção
-- CREATE TRIGGER assessments_deprecation_warning
--   INSTEAD OF INSERT OR UPDATE OR DELETE ON assessments
--   FOR EACH ROW
--   EXECUTE FUNCTION log_assessment_legacy_usage();

COMMENT ON FUNCTION log_assessment_legacy_usage() IS
'Função para logar uso da view assessments legada.
Útil para monitorar quando código antigo ainda está usando a API antiga.
Desabilitada por padrão para não poluir logs.';

-- =================== STEP 6: MIGRATION STATUS TABLE ===================

-- Criar tabela para rastrear status da migração
CREATE TABLE IF NOT EXISTS assessment_migration_status (
  id SERIAL PRIMARY KEY,
  migration_name VARCHAR NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status VARCHAR NOT NULL CHECK (status IN ('in_progress', 'completed', 'rolled_back')),
  notes TEXT,
  created_by VARCHAR,

  CONSTRAINT uq_migration_name UNIQUE (migration_name)
);

COMMENT ON TABLE assessment_migration_status IS
'Rastreamento de status da migração assessment_instances.
Permite rollback controlado se necessário.';

-- Registrar esta migração
INSERT INTO assessment_migration_status (
  migration_name,
  status,
  notes,
  created_by
)
VALUES (
  'assessment_restructure_to_extraction_pattern',
  'completed',
  'Criadas tabelas: assessment_instances, assessment_responses, assessment_evidence. View de compatibilidade: assessments. Tabela antiga: assessments_legacy.',
  current_user
)
ON CONFLICT (migration_name) DO UPDATE
SET
  completed_at = NOW(),
  status = 'completed',
  notes = EXCLUDED.notes;

-- =================== STEP 7: ROLLBACK HELPER FUNCTION ===================

-- Função para rollback da migração (emergência)
CREATE OR REPLACE FUNCTION rollback_assessment_restructure()
RETURNS void AS $$
BEGIN
  RAISE NOTICE 'Iniciando rollback de assessment restructure...';

  -- Drop view e triggers
  DROP TRIGGER IF EXISTS assessments_instead_of_insert ON assessments;
  DROP TRIGGER IF EXISTS assessments_instead_of_update ON assessments;
  DROP TRIGGER IF EXISTS assessments_instead_of_delete ON assessments;
  DROP VIEW IF EXISTS assessments CASCADE;

  -- Restaurar tabela antiga
  ALTER TABLE IF EXISTS assessments_legacy RENAME TO assessments;

  -- Atualizar status
  UPDATE assessment_migration_status
  SET
    status = 'rolled_back',
    completed_at = NOW(),
    notes = 'Rollback executado. Tabela assessments restaurada.'
  WHERE migration_name = 'assessment_restructure_to_extraction_pattern';

  RAISE NOTICE 'Rollback concluído. Tabela assessments restaurada.';
  RAISE WARNING 'ATENÇÃO: Dados em assessment_instances/responses NÃO foram migrados de volta. Execute migração manual se necessário.';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION rollback_assessment_restructure() IS
'Função de emergência para rollback da reestruturação de assessments.
Restaura tabela assessments original e remove view de compatibilidade.
ATENÇÃO: Dados em assessment_instances/responses não são migrados de volta automaticamente.';

-- =================== FIM DA MIGRATION ===================

-- Verificação final
DO $$
DECLARE
  v_legacy_count INTEGER;
  v_instances_count INTEGER;
  v_responses_count INTEGER;
BEGIN
  -- Contar registros
  SELECT COUNT(*) INTO v_legacy_count FROM assessments_legacy;
  SELECT COUNT(*) INTO v_instances_count FROM assessment_instances;
  SELECT COUNT(*) INTO v_responses_count FROM assessment_responses;

  RAISE NOTICE '=== ASSESSMENT RESTRUCTURE SUMMARY ===';
  RAISE NOTICE 'Legacy assessments: %', v_legacy_count;
  RAISE NOTICE 'New instances: %', v_instances_count;
  RAISE NOTICE 'New responses: %', v_responses_count;
  RAISE NOTICE 'Compatibility view: assessments (emulates legacy table)';
  RAISE NOTICE 'Migration status: completed';
  RAISE NOTICE '======================================';
END $$;
