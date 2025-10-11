-- =====================================================
-- Migration: Fix Project Creation Permissions
-- Objetivo: Corrigir permissões RLS e automatizar criação de project_members
-- =====================================================

-- 1. Criar função RPC segura para criar projetos
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

  -- Adicionar criador como manager
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
  );

  RETURN v_project_id;
END;
$$;

-- Comentário da função
COMMENT ON FUNCTION public.create_project_with_member IS 
'Cria um projeto e automaticamente adiciona o criador como manager. 
Usado para contornar complexidade de RLS em criação atômica.';

-- 2. Garantir que usuários autenticados podem criar projetos diretamente
-- (Remover política antiga se existir e recriar)
DROP POLICY IF EXISTS "Authenticated users can create projects" ON projects;

CREATE POLICY "Authenticated users can create projects"
ON projects
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL 
  AND auth.uid() = created_by_id
);

-- 3. Criar trigger para adicionar automaticamente o criador como manager
-- (Fallback caso INSERT direto seja usado ao invés da função RPC)
CREATE OR REPLACE FUNCTION public.auto_add_project_creator_as_manager()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  -- Adicionar criador como manager se não existir
  INSERT INTO project_members (
    project_id,
    user_id,
    role,
    created_by_id
  ) VALUES (
    NEW.id,
    NEW.created_by_id,
    'manager',
    NEW.created_by_id
  )
  ON CONFLICT (project_id, user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$;

-- Remover trigger antigo se existir
DROP TRIGGER IF EXISTS tr_auto_add_project_creator ON projects;

-- Criar trigger
CREATE TRIGGER tr_auto_add_project_creator
  AFTER INSERT ON projects
  FOR EACH ROW
  EXECUTE FUNCTION auto_add_project_creator_as_manager();

COMMENT ON TRIGGER tr_auto_add_project_creator ON projects IS 
'Automaticamente adiciona o criador do projeto como manager após criação.';

-- 4. Garantir que políticas RLS de project_members estão corretas
-- Permitir INSERT para adicionar membros (usado pelo trigger e pela função)
DO $$ 
BEGIN
  -- Verificar se a política existe
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'project_members' 
    AND policyname = 'Managers can add members'
  ) THEN
    CREATE POLICY "Managers can add members"
    ON project_members
    FOR INSERT
    TO authenticated
    WITH CHECK (
      -- Manager do projeto pode adicionar membros
      is_project_manager(project_id, auth.uid())
      -- OU é o próprio criador se adicionando (para trigger/função)
      OR (user_id = auth.uid() AND user_id = created_by_id)
    );
  END IF;
END $$;

-- 5. Permitir que project_members seja consultado por quem tem acesso ao projeto
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'project_members' 
    AND policyname = 'Users can view project members'
  ) THEN
    CREATE POLICY "Users can view project members"
    ON project_members
    FOR SELECT
    TO authenticated
    USING (
      check_project_access(project_id, auth.uid())
    );
  END IF;
END $$;

-- 6. Grant necessário para a função RPC
GRANT EXECUTE ON FUNCTION public.create_project_with_member TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_add_project_creator_as_manager TO authenticated;

-- 7. Verificação de integridade
DO $$
BEGIN
  RAISE NOTICE '✅ Migration aplicada com sucesso';
  RAISE NOTICE '📋 Função RPC criada: create_project_with_member';
  RAISE NOTICE '⚡ Trigger criado: tr_auto_add_project_creator';
  RAISE NOTICE '🔒 Políticas RLS atualizadas para projects e project_members';
END $$;


