-- =====================================================
-- MIGRATION: Add DELETE Policy for Projects
-- =====================================================
-- Descrição: Adiciona política RLS para permitir DELETE
-- de projetos apenas para managers ou criador do projeto
-- =====================================================

-- Política para permitir que managers ou criador do projeto possam deletar
CREATE POLICY "Managers or owner can delete projects"
  ON projects FOR DELETE
  USING (
    -- Criador do projeto pode deletar
    created_by_id = auth.uid()
    OR
    -- Managers podem deletar
    is_project_manager(id, auth.uid())
  );

COMMENT ON POLICY "Managers or owner can delete projects" ON projects IS 
'Permite que o criador do projeto ou managers possam deletar projetos. 
A deleção em cascade remove automaticamente todos os dados relacionados.';


