-- =====================================================
-- MIGRATION: Add get_project_members Function
-- =====================================================
-- Descrição: Cria função RPC para listar membros de um projeto
-- com dados do perfil, contornando o RLS da tabela profiles.
--
-- Problema: O RLS da tabela profiles restringe leitura ao
-- próprio perfil, impedindo visualização de outros membros.
-- =====================================================

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
