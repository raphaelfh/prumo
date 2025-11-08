-- =====================================================
-- MIGRATION: Migrar Template CHARMS - Campos "Other (specify)"
-- =====================================================
-- Descrição: Migra campos "Other - Specify" do template CHARMS 2.0
-- para usar allow_other=true nos campos principais ao invés de campos separados.
-- =====================================================

DO $$
DECLARE
  v_template_id UUID;
  v_field_id UUID;
  v_allowed_values JSONB;
  v_new_allowed_values JSONB;
BEGIN
  -- Encontrar template CHARMS (suporta tanto "CHARMS 2.0" antigo quanto "CHARMS" novo)
  SELECT id INTO v_template_id
  FROM extraction_templates_global
  WHERE (name = 'CHARMS' AND version = '1.0.0') OR (name = 'CHARMS 2.0' AND version = '2.0.0')
  LIMIT 1;

  IF v_template_id IS NULL THEN
    RAISE NOTICE 'Template CHARMS não encontrado. Pulando migração.';
    RETURN;
  END IF;

  RAISE NOTICE 'Migrando template CHARMS: %', v_template_id;

  -- =================== LISTA DE CAMPOS A MIGRAR ===================
  -- Para cada campo principal, vamos:
  -- 1. Adicionar allow_other=true
  -- 2. Remover "Other (specify)" de allowed_values
  -- 3. Deletar campo *_other_specify correspondente

  -- 1. modelling_method
  SELECT ef.id INTO v_field_id
  FROM extraction_fields ef
  JOIN extraction_entity_types et ON ef.entity_type_id = et.id
  WHERE et.template_id = v_template_id
    AND ef.name = 'modelling_method'
  LIMIT 1;

  IF v_field_id IS NOT NULL THEN
    -- Atualizar allowed_values removendo "Other (specify)"
    SELECT allowed_values INTO v_allowed_values
    FROM extraction_fields
    WHERE id = v_field_id;

    IF v_allowed_values IS NOT NULL THEN
      v_new_allowed_values := (
        SELECT jsonb_agg(value)
        FROM jsonb_array_elements_text(v_allowed_values) AS value
        WHERE value != 'Other (specify)'
      );

      UPDATE extraction_fields
      SET 
        allow_other = true,
        other_label = 'Outro (especificar)',
        allowed_values = v_new_allowed_values
      WHERE id = v_field_id;

      RAISE NOTICE 'Campo modelling_method atualizado';
    END IF;
  END IF;

  -- Deletar campo modelling_method_other_specify
  DELETE FROM extraction_fields
  WHERE id IN (
    SELECT ef.id
    FROM extraction_fields ef
    JOIN extraction_entity_types et ON ef.entity_type_id = et.id
    WHERE et.template_id = v_template_id
      AND ef.name = 'modelling_method_other_specify'
  );

  -- 2. data_source
  SELECT ef.id INTO v_field_id
  FROM extraction_fields ef
  JOIN extraction_entity_types et ON ef.entity_type_id = et.id
  WHERE et.template_id = v_template_id
    AND ef.name = 'data_source'
  LIMIT 1;

  IF v_field_id IS NOT NULL THEN
    SELECT allowed_values INTO v_allowed_values
    FROM extraction_fields
    WHERE id = v_field_id;

    IF v_allowed_values IS NOT NULL THEN
      v_new_allowed_values := (
        SELECT jsonb_agg(value)
        FROM jsonb_array_elements_text(v_allowed_values) AS value
        WHERE value != 'Other (specify)'
      );

      UPDATE extraction_fields
      SET 
        allow_other = true,
        other_label = 'Outro (especificar)',
        allowed_values = v_new_allowed_values
      WHERE id = v_field_id;

      RAISE NOTICE 'Campo data_source atualizado';
    END IF;
  END IF;

  DELETE FROM extraction_fields
  WHERE id IN (
    SELECT ef.id
    FROM extraction_fields ef
    JOIN extraction_entity_types et ON ef.entity_type_id = et.id
    WHERE et.template_id = v_template_id
      AND ef.name = 'data_source_other_specify'
  );

  -- 3. recruitment_method
  SELECT ef.id INTO v_field_id
  FROM extraction_fields ef
  JOIN extraction_entity_types et ON ef.entity_type_id = et.id
  WHERE et.template_id = v_template_id
    AND ef.name = 'recruitment_method'
  LIMIT 1;

  IF v_field_id IS NOT NULL THEN
    SELECT allowed_values INTO v_allowed_values
    FROM extraction_fields
    WHERE id = v_field_id;

    IF v_allowed_values IS NOT NULL THEN
      v_new_allowed_values := (
        SELECT jsonb_agg(value)
        FROM jsonb_array_elements_text(v_allowed_values) AS value
        WHERE value != 'Other (specify)'
      );

      UPDATE extraction_fields
      SET 
        allow_other = true,
        other_label = 'Outro (especificar)',
        allowed_values = v_new_allowed_values
      WHERE id = v_field_id;

      RAISE NOTICE 'Campo recruitment_method atualizado';
    END IF;
  END IF;

  DELETE FROM extraction_fields
  WHERE id IN (
    SELECT ef.id
    FROM extraction_fields ef
    JOIN extraction_entity_types et ON ef.entity_type_id = et.id
    WHERE et.template_id = v_template_id
      AND ef.name = 'recruitment_method_other_specify'
  );

  -- 4. timing_of_measurement
  SELECT ef.id INTO v_field_id
  FROM extraction_fields ef
  JOIN extraction_entity_types et ON ef.entity_type_id = et.id
  WHERE et.template_id = v_template_id
    AND ef.name = 'timing_of_measurement'
  LIMIT 1;

  IF v_field_id IS NOT NULL THEN
    SELECT allowed_values INTO v_allowed_values
    FROM extraction_fields
    WHERE id = v_field_id;

    IF v_allowed_values IS NOT NULL THEN
      v_new_allowed_values := (
        SELECT jsonb_agg(value)
        FROM jsonb_array_elements_text(v_allowed_values) AS value
        WHERE value != 'Other (specify)'
      );

      UPDATE extraction_fields
      SET 
        allow_other = true,
        other_label = 'Outro (especificar)',
        allowed_values = v_new_allowed_values
      WHERE id = v_field_id;

      RAISE NOTICE 'Campo timing_of_measurement atualizado';
    END IF;
  END IF;

  DELETE FROM extraction_fields
  WHERE id IN (
    SELECT ef.id
    FROM extraction_fields ef
    JOIN extraction_entity_types et ON ef.entity_type_id = et.id
    WHERE et.template_id = v_template_id
      AND ef.name = 'timing_of_measurement_other_specify'
  );

  -- 5. handling_continuous
  SELECT ef.id INTO v_field_id
  FROM extraction_fields ef
  JOIN extraction_entity_types et ON ef.entity_type_id = et.id
  WHERE et.template_id = v_template_id
    AND ef.name = 'handling_continuous'
  LIMIT 1;

  IF v_field_id IS NOT NULL THEN
    SELECT allowed_values INTO v_allowed_values
    FROM extraction_fields
    WHERE id = v_field_id;

    IF v_allowed_values IS NOT NULL THEN
      v_new_allowed_values := (
        SELECT jsonb_agg(value)
        FROM jsonb_array_elements_text(v_allowed_values) AS value
        WHERE value != 'Other (specify)'
      );

      UPDATE extraction_fields
      SET 
        allow_other = true,
        other_label = 'Outro (especificar)',
        allowed_values = v_new_allowed_values
      WHERE id = v_field_id;

      RAISE NOTICE 'Campo handling_continuous atualizado';
    END IF;
  END IF;

  DELETE FROM extraction_fields
  WHERE id IN (
    SELECT ef.id
    FROM extraction_fields ef
    JOIN extraction_entity_types et ON ef.entity_type_id = et.id
    WHERE et.template_id = v_template_id
      AND ef.name = 'handling_continuous_other_specify'
  );

  -- 6. handling_of_missing
  SELECT ef.id INTO v_field_id
  FROM extraction_fields ef
  JOIN extraction_entity_types et ON ef.entity_type_id = et.id
  WHERE et.template_id = v_template_id
    AND ef.name = 'handling_of_missing'
  LIMIT 1;

  IF v_field_id IS NOT NULL THEN
    SELECT allowed_values INTO v_allowed_values
    FROM extraction_fields
    WHERE id = v_field_id;

    IF v_allowed_values IS NOT NULL THEN
      v_new_allowed_values := (
        SELECT jsonb_agg(value)
        FROM jsonb_array_elements_text(v_allowed_values) AS value
        WHERE value != 'Other (specify)'
      );

      UPDATE extraction_fields
      SET 
        allow_other = true,
        other_label = 'Outro (especificar)',
        allowed_values = v_new_allowed_values
      WHERE id = v_field_id;

      RAISE NOTICE 'Campo handling_of_missing atualizado';
    END IF;
  END IF;

  DELETE FROM extraction_fields
  WHERE id IN (
    SELECT ef.id
    FROM extraction_fields ef
    JOIN extraction_entity_types et ON ef.entity_type_id = et.id
    WHERE et.template_id = v_template_id
      AND ef.name = 'handling_of_missing_other_specify'
  );

  -- 7. selection_method_candidates
  SELECT ef.id INTO v_field_id
  FROM extraction_fields ef
  JOIN extraction_entity_types et ON ef.entity_type_id = et.id
  WHERE et.template_id = v_template_id
    AND ef.name = 'selection_method_candidates'
  LIMIT 1;

  IF v_field_id IS NOT NULL THEN
    SELECT allowed_values INTO v_allowed_values
    FROM extraction_fields
    WHERE id = v_field_id;

    IF v_allowed_values IS NOT NULL THEN
      v_new_allowed_values := (
        SELECT jsonb_agg(value)
        FROM jsonb_array_elements_text(v_allowed_values) AS value
        WHERE value != 'Other (specify)'
      );

      UPDATE extraction_fields
      SET 
        allow_other = true,
        other_label = 'Outro (especificar)',
        allowed_values = v_new_allowed_values
      WHERE id = v_field_id;

      RAISE NOTICE 'Campo selection_method_candidates atualizado';
    END IF;
  END IF;

  DELETE FROM extraction_fields
  WHERE id IN (
    SELECT ef.id
    FROM extraction_fields ef
    JOIN extraction_entity_types et ON ef.entity_type_id = et.id
    WHERE et.template_id = v_template_id
      AND ef.name = 'selection_method_candidates_other_specify'
  );

  -- 8. selection_method_multivariable
  SELECT ef.id INTO v_field_id
  FROM extraction_fields ef
  JOIN extraction_entity_types et ON ef.entity_type_id = et.id
  WHERE et.template_id = v_template_id
    AND ef.name = 'selection_method_multivariable'
  LIMIT 1;

  IF v_field_id IS NOT NULL THEN
    SELECT allowed_values INTO v_allowed_values
    FROM extraction_fields
    WHERE id = v_field_id;

    IF v_allowed_values IS NOT NULL THEN
      v_new_allowed_values := (
        SELECT jsonb_agg(value)
        FROM jsonb_array_elements_text(v_allowed_values) AS value
        WHERE value != 'Other (specify)'
      );

      UPDATE extraction_fields
      SET 
        allow_other = true,
        other_label = 'Outro (especificar)',
        allowed_values = v_new_allowed_values
      WHERE id = v_field_id;

      RAISE NOTICE 'Campo selection_method_multivariable atualizado';
    END IF;
  END IF;

  DELETE FROM extraction_fields
  WHERE id IN (
    SELECT ef.id
    FROM extraction_fields ef
    JOIN extraction_entity_types et ON ef.entity_type_id = et.id
    WHERE et.template_id = v_template_id
      AND ef.name = 'selection_method_multivariable_other_specify'
  );

  -- 9. internal_validation
  SELECT ef.id INTO v_field_id
  FROM extraction_fields ef
  JOIN extraction_entity_types et ON ef.entity_type_id = et.id
  WHERE et.template_id = v_template_id
    AND ef.name = 'internal_validation'
  LIMIT 1;

  IF v_field_id IS NOT NULL THEN
    SELECT allowed_values INTO v_allowed_values
    FROM extraction_fields
    WHERE id = v_field_id;

    IF v_allowed_values IS NOT NULL THEN
      v_new_allowed_values := (
        SELECT jsonb_agg(value)
        FROM jsonb_array_elements_text(v_allowed_values) AS value
        WHERE value != 'Other (specify)'
      );

      UPDATE extraction_fields
      SET 
        allow_other = true,
        other_label = 'Outro (especificar)',
        allowed_values = v_new_allowed_values
      WHERE id = v_field_id;

      RAISE NOTICE 'Campo internal_validation atualizado';
    END IF;
  END IF;

  DELETE FROM extraction_fields
  WHERE id IN (
    SELECT ef.id
    FROM extraction_fields ef
    JOIN extraction_entity_types et ON ef.entity_type_id = et.id
    WHERE et.template_id = v_template_id
      AND ef.name = 'internal_validation_other_specify'
  );

  -- 10. external_validation
  SELECT ef.id INTO v_field_id
  FROM extraction_fields ef
  JOIN extraction_entity_types et ON ef.entity_type_id = et.id
  WHERE et.template_id = v_template_id
    AND ef.name = 'external_validation'
  LIMIT 1;

  IF v_field_id IS NOT NULL THEN
    SELECT allowed_values INTO v_allowed_values
    FROM extraction_fields
    WHERE id = v_field_id;

    IF v_allowed_values IS NOT NULL THEN
      v_new_allowed_values := (
        SELECT jsonb_agg(value)
        FROM jsonb_array_elements_text(v_allowed_values) AS value
        WHERE value != 'Other (specify)'
      );

      UPDATE extraction_fields
      SET 
        allow_other = true,
        other_label = 'Outro (especificar)',
        allowed_values = v_new_allowed_values
      WHERE id = v_field_id;

      RAISE NOTICE 'Campo external_validation atualizado';
    END IF;
  END IF;

  DELETE FROM extraction_fields
  WHERE id IN (
    SELECT ef.id
    FROM extraction_fields ef
    JOIN extraction_entity_types et ON ef.entity_type_id = et.id
    WHERE et.template_id = v_template_id
      AND ef.name = 'external_validation_other_specify'
  );

  -- 11. alternative_presentation
  SELECT ef.id INTO v_field_id
  FROM extraction_fields ef
  JOIN extraction_entity_types et ON ef.entity_type_id = et.id
  WHERE et.template_id = v_template_id
    AND ef.name = 'alternative_presentation'
  LIMIT 1;

  IF v_field_id IS NOT NULL THEN
    SELECT allowed_values INTO v_allowed_values
    FROM extraction_fields
    WHERE id = v_field_id;

    IF v_allowed_values IS NOT NULL THEN
      v_new_allowed_values := (
        SELECT jsonb_agg(value)
        FROM jsonb_array_elements_text(v_allowed_values) AS value
        WHERE value != 'Other (specify)'
      );

      UPDATE extraction_fields
      SET 
        allow_other = true,
        other_label = 'Outro (especificar)',
        allowed_values = v_new_allowed_values
      WHERE id = v_field_id;

      RAISE NOTICE 'Campo alternative_presentation atualizado';
    END IF;
  END IF;

  DELETE FROM extraction_fields
  WHERE id IN (
    SELECT ef.id
    FROM extraction_fields ef
    JOIN extraction_entity_types et ON ef.entity_type_id = et.id
    WHERE et.template_id = v_template_id
      AND ef.name = 'alternative_presentation_other_specify'
  );

  RAISE NOTICE 'Migração do template CHARMS concluída!';
END $$;

