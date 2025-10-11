-- =====================================================
-- MIGRATION: Corrigir função initialize_existing_project_template
-- =====================================================
-- Descrição: Atualizar referências de extraction_templates para extraction_templates_global
-- Problema: Função de inicialização referenciava tabela que não existe mais
-- =====================================================

-- Recriar função com referências corretas
CREATE OR REPLACE FUNCTION public.initialize_existing_project_template(p_project_id uuid)
RETURNS void
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
    WHERE project_id = p_project_id AND is_active = TRUE
  ) THEN
    RETURN;
  END IF;
  
  -- Buscar template CHARMS global mais recente
  -- CORRIGIDO: extraction_templates → extraction_templates_global
  SELECT id INTO v_template_id
  FROM extraction_templates_global
  WHERE framework = 'CHARMS' AND is_global = TRUE
  ORDER BY created_at DESC
  LIMIT 1;
  
  -- Se não encontrar template, não fazer nada
  IF v_template_id IS NULL THEN
    RAISE NOTICE 'Template CHARMS não encontrado';
    RETURN;
  END IF;
  
  -- Criar template para o projeto existente
  -- CORRIGIDO: extraction_templates → extraction_templates_global
  INSERT INTO project_extraction_templates (
    project_id, global_template_id, name, description,
    framework, version, schema, is_active, created_by
  )
  SELECT
    p_project_id, v_template_id,
    name || ' (Inicializado)', description,
    framework, version, schema, TRUE,
    (SELECT created_by_id FROM projects WHERE id = p_project_id)
  FROM extraction_templates_global
  WHERE id = v_template_id;
END;
$function$;

-- Comentário explicativo
COMMENT ON FUNCTION public.initialize_existing_project_template IS 
'Inicializa template CHARMS para projetos existentes que não possuem template ativo.
Atualizado para usar extraction_templates_global ao invés de extraction_templates.';

-- Log de sucesso
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Função initialize_existing_project_template corrigida';
  RAISE NOTICE 'Referências atualizadas para extraction_templates_global';
  RAISE NOTICE '========================================';
END $$;

