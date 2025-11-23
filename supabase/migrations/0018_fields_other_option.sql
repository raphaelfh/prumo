-- =====================================================
-- MIGRATION: Extraction Fields - Other (especificar) + Project validation
-- =====================================================
-- Descrição: Adiciona suporte a "Outro (especificar)" configurável por campo
-- e validação leve de project_id consistente entre parent e child instances.
-- =====================================================

-- =================== ALTER TABLE: extraction_fields ===================

ALTER TABLE extraction_fields
  ADD COLUMN IF NOT EXISTS allow_other boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS other_label character varying NOT NULL DEFAULT 'Outro (especificar)',
  ADD COLUMN IF NOT EXISTS other_placeholder character varying;

COMMENT ON COLUMN extraction_fields.allow_other IS 'Quando true, UI apresenta opção "Outro (especificar)" inline';
COMMENT ON COLUMN extraction_fields.other_label IS 'Label exibido para a opção "Outro"';
COMMENT ON COLUMN extraction_fields.other_placeholder IS 'Placeholder para o input de "Outro"';

-- =================== TRIGGER: validar project_id consistente ===================

CREATE OR REPLACE FUNCTION validate_instance_project_consistency()
RETURNS TRIGGER AS $$
DECLARE
  v_parent extraction_instances%ROWTYPE;
BEGIN
  IF NEW.parent_instance_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_parent FROM extraction_instances WHERE id = NEW.parent_instance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent instance % não encontrado', NEW.parent_instance_id;
  END IF;

  IF v_parent.project_id != NEW.project_id THEN
    RAISE EXCEPTION 'Parent e child devem pertencer ao mesmo project_id';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_instance_project
  BEFORE INSERT OR UPDATE OF parent_instance_id, project_id
  ON extraction_instances
  FOR EACH ROW
  EXECUTE FUNCTION validate_instance_project_consistency();

COMMENT ON TRIGGER trg_validate_instance_project ON extraction_instances IS
'Garante que parent e child instances tenham o mesmo project_id.';


