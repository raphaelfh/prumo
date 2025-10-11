-- Adiciona política RLS para permitir deleção de projetos
-- Apenas managers/criadores podem deletar projetos
-- 
-- Problema: A tabela projects tinha RLS habilitado mas não possuía política
-- para DELETE, resultando em deleções silenciosamente bloqueadas (aparecia
-- sucesso no frontend mas o projeto continuava no banco).

CREATE POLICY "Managers can delete projects"
ON public.projects
FOR DELETE
USING (
  -- Permite deleção se o usuário é manager do projeto
  public.is_project_manager(id, auth.uid())
  OR
  -- Ou se é o criador do projeto (fallback de segurança)
  created_by_id = auth.uid()
);

