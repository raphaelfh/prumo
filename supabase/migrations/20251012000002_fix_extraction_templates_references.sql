-- =====================================================
-- MIGRATION: Corrigir Referências a extraction_templates
-- =====================================================
-- Descrição: Cria view para compatibilidade com código/triggers antigos
-- que referenciam extraction_templates (nome antigo)
-- =====================================================

-- Criar view extraction_templates como alias de extraction_templates_global
CREATE OR REPLACE VIEW extraction_templates AS
SELECT * FROM extraction_templates_global;

-- Comentário explicativo
COMMENT ON VIEW extraction_templates IS 
  'View de compatibilidade. Aponta para extraction_templates_global. Use extraction_templates_global diretamente em código novo.';

-- Log
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'View extraction_templates criada';
  RAISE NOTICE 'Compatibilidade com código legado garantida';
  RAISE NOTICE '========================================';
END $$;

