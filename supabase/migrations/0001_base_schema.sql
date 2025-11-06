-- =====================================================
-- MIGRATION: Base Schema - Extensions and Helper Functions
-- =====================================================
-- Descrição: Configura extensões PostgreSQL e funções auxiliares
-- necessárias para o sistema
-- =====================================================

-- =================== EXTENSIONS ===================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- =================== HELPER FUNCTIONS ===================

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN 
  NEW.updated_at := NOW(); 
  RETURN NEW; 
END $$;

COMMENT ON FUNCTION set_updated_at() IS 
'Função auxiliar para triggers que atualizam automaticamente o campo updated_at';

-- Função para criar profile automaticamente quando um usuário é criado
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id, 
    NEW.email, 
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS 
'Trigger function que cria automaticamente um profile quando um usuário é criado em auth.users';

-- =================== RLS HELPER FUNCTIONS ===================
-- NOTA: Funções RLS que dependem de tabelas (is_project_member, is_project_manager)
-- foram movidas para a migration 0003_core_tables.sql após criar as tabelas
-- projects e project_members

