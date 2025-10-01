-- Allow creators to view their own projects
CREATE POLICY "Creators can view own projects"
ON public.projects
FOR SELECT
USING (created_by_id = auth.uid());

-- Allow project creators to add themselves as managers immediately after creation
CREATE POLICY "Creators can add themselves as manager"
ON public.project_members
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id AND p.created_by_id = auth.uid()
  )
);
