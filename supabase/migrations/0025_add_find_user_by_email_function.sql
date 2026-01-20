-- =====================================================
-- MIGRATION: Add find_user_id_by_email Function
-- =====================================================
-- Descrição: Cria função RPC segura para buscar usuário por email.
-- Esta função é necessária porque o RLS da tabela profiles
-- restringe a leitura apenas ao próprio perfil do usuário.
--
-- Problema resolvido: Permitir que gerentes de projeto encontrem
-- usuários por email para adicioná-los como membros do projeto.
-- =====================================================

-- Função para buscar ID de usuário por email de forma segura
-- Usa SECURITY DEFINER para executar com privilégios elevados
-- mas retorna apenas o ID, protegendo dados sensíveis
CREATE OR REPLACE FUNCTION find_user_id_by_email(search_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  found_id UUID;
BEGIN
  -- Validar input
  IF search_email IS NULL OR TRIM(search_email) = '' THEN
    RETURN NULL;
  END IF;

  -- Busca case-insensitive por email
  -- Retorna apenas o ID, não expõe outros dados do perfil
  SELECT id INTO found_id
  FROM profiles
  WHERE LOWER(TRIM(email)) = LOWER(TRIM(search_email));

  RETURN found_id;
END;
$$;

-- Comentário para documentação
COMMENT ON FUNCTION find_user_id_by_email IS
  'Busca o ID de um usuário pelo email de forma segura.
   Retorna apenas o UUID, sem expor outros dados do perfil.
   Usado para adicionar membros a projetos.';

-- Permitir que usuários autenticados executem a função
GRANT EXECUTE ON FUNCTION find_user_id_by_email(TEXT) TO authenticated;
