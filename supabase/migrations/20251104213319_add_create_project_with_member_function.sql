-- =====================================================
-- MIGRATION: Add create_project_with_member Function
-- =====================================================
-- Descrição: Cria função RPC para criar projeto e adicionar criador como manager
-- =====================================================

-- Função para criar projeto e adicionar criador como manager atomicamente
CREATE OR REPLACE FUNCTION public.create_project_with_member(
  p_name text,
  p_description text DEFAULT NULL,
  p_review_title text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_project_id uuid;
  v_user_id uuid;
BEGIN
  -- Validar input
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Nome do projeto é obrigatório';
  END IF;

  -- Obter user_id autenticado
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  -- Criar projeto
  INSERT INTO projects (
    name,
    description,
    review_title,
    created_by_id,
    is_active
  ) VALUES (
    trim(p_name),
    p_description,
    p_review_title,
    v_user_id,
    true
  )
  RETURNING id INTO v_project_id;

  -- Adicionar criador como manager (com proteção contra duplicação)
  -- Usamos ON CONFLICT para evitar erro se já existir
  INSERT INTO project_members (
    project_id,
    user_id,
    role,
    created_by_id
  ) VALUES (
    v_project_id,
    v_user_id,
    'manager',
    v_user_id
  )
  ON CONFLICT (project_id, user_id) DO NOTHING;

  RETURN v_project_id;
END;
$$;

-- Comentário da função
COMMENT ON FUNCTION public.create_project_with_member IS 
'Cria um projeto e automaticamente adiciona o criador como manager.
Usa ON CONFLICT DO NOTHING para evitar duplicação.
Retorna o UUID do projeto criado.';

-- Garantir permissões de execução para usuários autenticados
GRANT EXECUTE ON FUNCTION public.create_project_with_member TO authenticated;





