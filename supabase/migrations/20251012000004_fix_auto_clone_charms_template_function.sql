-- =====================================================
-- MIGRATION: Corrigir função auto_clone_charms_template
-- =====================================================
-- Descrição: Atualizar referências de extraction_templates para extraction_templates_global
-- Problema: Trigger de criação de projeto falhava com erro "relation extraction_templates does not exist"
-- =====================================================

-- Recriar função com referências corretas
CREATE OR REPLACE FUNCTION public.auto_clone_charms_template()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_template_id UUID;
BEGIN
  -- Se já existe um template ativo para o projeto, não fazer nada
  IF EXISTS (
    SELECT 1 FROM project_extraction_templates
    WHERE project_id = NEW.id AND is_active = TRUE
  ) THEN
    RETURN NEW;
  END IF;
  
  -- Buscar template CHARMS global mais recente
  -- CORRIGIDO: extraction_templates → extraction_templates_global
  SELECT id INTO v_template_id
  FROM extraction_templates_global
  WHERE framework = 'CHARMS' AND is_global = TRUE
  ORDER BY created_at DESC
  LIMIT 1;
  
  -- Se não encontrar template, não fazer nada (projeto sem template)
  IF v_template_id IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Clonar template global para o projeto
  -- CORRIGIDO: extraction_templates → extraction_templates_global
  INSERT INTO project_extraction_templates (
    project_id, global_template_id, name, description,
    framework, version, schema, is_active, created_by
  )
  SELECT
    NEW.id, v_template_id,
    name || ' (Projeto: ' || NEW.name || ')',
    description, framework, version, schema, TRUE, NEW.created_by_id
  FROM extraction_templates_global
  WHERE id = v_template_id;
  
  RETURN NEW;
END;
$function$;

-- Comentário explicativo
COMMENT ON FUNCTION public.auto_clone_charms_template IS 
'Trigger function que clona automaticamente o template CHARMS global mais recente para novos projetos.
Atualizado para usar extraction_templates_global ao invés de extraction_templates.';

-- Log de sucesso
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Função auto_clone_charms_template corrigida';
  RAISE NOTICE 'Referências atualizadas para extraction_templates_global';
  RAISE NOTICE '========================================';
END $$;

