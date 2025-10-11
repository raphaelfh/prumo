-- =====================================================
-- MIGRATION: Limpar Funções Órfãs
-- =====================================================
-- Descrição: Remove funções que não têm triggers associados
-- e não são chamadas em lugar nenhum do código
-- =====================================================

-- =================== REMOVER FUNÇÕES ÓRFÃS ===================

-- Função auto_clone_charms_template: criada mas nunca teve trigger
-- O fluxo correto é o usuário escolher manualmente na UI
DROP FUNCTION IF EXISTS public.auto_clone_charms_template() CASCADE;

-- Função initialize_existing_project_template: mesma situação
-- Não é chamada em lugar nenhum
DROP FUNCTION IF EXISTS public.initialize_existing_project_template(uuid) CASCADE;

-- =================== DOCUMENTAÇÃO ===================

-- Adicionar comentário explicativo na tabela
COMMENT ON TABLE public.project_extraction_templates IS 
'Templates de extração por projeto. 
Templates devem ser clonados EXPLICITAMENTE pelo usuário através da UI 
(aba Extraction > Configuração > Importar Template).
Não há auto-clonagem automática na criação de projetos.';

-- =================== LOG FINAL ===================

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Limpeza de funções órfãs concluída';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Funções removidas:';
  RAISE NOTICE '  - auto_clone_charms_template()';
  RAISE NOTICE '  - initialize_existing_project_template()';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Fluxo correto:';
  RAISE NOTICE '  1. User cria projeto';
  RAISE NOTICE '  2. User vai em Extraction > Configuração';
  RAISE NOTICE '  3. User clica "Importar Template"';
  RAISE NOTICE '  4. Frontend clona entity_types + fields';
  RAISE NOTICE '========================================';
END $$;

