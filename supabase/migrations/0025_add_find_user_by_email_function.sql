-- =====================================================
-- MIGRATION: Add Profile Lookup Functions for Projects
-- =====================================================
-- Descrição: Cria funções RPC seguras para operações que
-- precisam acessar dados de perfis de outros usuários.
--
-- Problema: O RLS da tabela profiles restringe leitura ao
-- próprio perfil, impedindo funcionalidades colaborativas.
--
-- Funções criadas:
-- 1. find_user_id_by_email: Buscar usuário por email
-- 2. get_project_members: Listar membros de um projeto
-- =====================================================

-- =================== FUNÇÃO 1: find_user_id_by_email ===================
-- Busca ID de usuário por email para adicionar como membro

CREATE OR REPLACE FUNCTION find_user_id_by_email(search_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  found_id UUID;
BEGIN
  IF search_email IS NULL OR TRIM(search_email) = '' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO found_id
  FROM profiles
  WHERE LOWER(TRIM(email)) = LOWER(TRIM(search_email));

  RETURN found_id;
END;
$$;

COMMENT ON FUNCTION find_user_id_by_email IS
  'Busca o ID de um usuário pelo email de forma segura.
   Retorna apenas o UUID, sem expor outros dados do perfil.';

GRANT EXECUTE ON FUNCTION find_user_id_by_email(TEXT) TO authenticated;


-- =================== FUNÇÃO 2: get_project_members ===================
-- Retorna membros do projeto com dados do perfil
-- Valida se o usuário atual tem acesso ao projeto

CREATE OR REPLACE FUNCTION get_project_members(p_project_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  role TEXT,
  permissions JSONB,
  created_at TIMESTAMPTZ,
  user_email TEXT,
  user_full_name TEXT,
  user_avatar_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verificar se o usuário atual é membro do projeto
  IF NOT EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = p_project_id
    AND pm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Acesso negado: você não é membro deste projeto';
  END IF;

  -- Retornar membros com dados do perfil
  RETURN QUERY
  SELECT
    pm.id,
    pm.user_id,
    pm.role::TEXT,
    pm.permissions,
    pm.created_at,
    p.email AS user_email,
    p.full_name AS user_full_name,
    p.avatar_url AS user_avatar_url
  FROM project_members pm
  LEFT JOIN profiles p ON p.id = pm.user_id
  WHERE pm.project_id = p_project_id
  ORDER BY pm.created_at DESC;
END;
$$;

COMMENT ON FUNCTION get_project_members IS
  'Retorna membros de um projeto com dados do perfil.
   Valida se o usuário atual tem acesso ao projeto.
   Usado na tela de gestão de equipe.';

GRANT EXECUTE ON FUNCTION get_project_members(UUID) TO authenticated;
