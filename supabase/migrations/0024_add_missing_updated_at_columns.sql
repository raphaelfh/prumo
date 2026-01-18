-- =============================================================================
-- Migração: 0024_add_missing_updated_at_columns.sql
-- Descrição: Adiciona coluna updated_at nas tabelas de extraction que faltavam.
--            Necessário para compatibilidade com modelos SQLAlchemy que usam
--            BaseModel (que inclui TimestampMixin com updated_at).
-- =============================================================================

-- Adicionar updated_at nas tabelas que faltam
ALTER TABLE extraction_entity_types 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

ALTER TABLE extraction_fields 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

ALTER TABLE extraction_runs 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

ALTER TABLE extraction_evidence 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

-- =============================================================================
-- Função genérica para atualizar updated_at (reutilizável)
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Triggers para atualização automática de updated_at
-- =============================================================================

-- extraction_entity_types
DROP TRIGGER IF EXISTS update_extraction_entity_types_updated_at ON extraction_entity_types;
CREATE TRIGGER update_extraction_entity_types_updated_at
    BEFORE UPDATE ON extraction_entity_types
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- extraction_fields
DROP TRIGGER IF EXISTS update_extraction_fields_updated_at ON extraction_fields;
CREATE TRIGGER update_extraction_fields_updated_at
    BEFORE UPDATE ON extraction_fields
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- extraction_runs
DROP TRIGGER IF EXISTS update_extraction_runs_updated_at ON extraction_runs;
CREATE TRIGGER update_extraction_runs_updated_at
    BEFORE UPDATE ON extraction_runs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- extraction_evidence
DROP TRIGGER IF EXISTS update_extraction_evidence_updated_at ON extraction_evidence;
CREATE TRIGGER update_extraction_evidence_updated_at
    BEFORE UPDATE ON extraction_evidence
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- Comentários
-- =============================================================================
COMMENT ON COLUMN extraction_entity_types.updated_at IS 'Última atualização do entity type';
COMMENT ON COLUMN extraction_fields.updated_at IS 'Última atualização do field';
COMMENT ON COLUMN extraction_runs.updated_at IS 'Última atualização do run';
COMMENT ON COLUMN extraction_evidence.updated_at IS 'Última atualização da evidência';
