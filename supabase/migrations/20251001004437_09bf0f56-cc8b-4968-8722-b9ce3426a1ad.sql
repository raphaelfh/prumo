-- Fix recursive RLS causing stack depth errors by removing self-referential policies on project_members
-- 1) Drop existing recursive policies
DROP POLICY IF EXISTS "Managers can manage members" ON public.project_members;
DROP POLICY IF EXISTS "Members can view project members" ON public.project_members;

-- 2) Recreate non-recursive, safe policies using only the projects table
-- Allow users to view their own membership rows and project owners to view all members
CREATE POLICY "Members can view project members"
ON public.project_members
FOR SELECT
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id AND p.created_by_id = auth.uid()
  )
);

-- Allow only project owners to manage membership (insert/update/delete)
CREATE POLICY "Project owner can manage members"
ON public.project_members
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id AND p.created_by_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id AND p.created_by_id = auth.uid()
  )
);
