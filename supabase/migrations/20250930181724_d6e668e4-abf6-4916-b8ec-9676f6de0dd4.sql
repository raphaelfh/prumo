-- Drop the problematic policy that causes infinite recursion
DROP POLICY IF EXISTS "Users can view projects they're members of" ON public.projects;

-- The function is_project_member already exists and uses security definer,
-- but let's create a simpler one just for checking membership
CREATE OR REPLACE FUNCTION public.check_project_access(p_project_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = p_project_id 
    AND user_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM projects
    WHERE id = p_project_id 
    AND created_by_id = p_user_id
  );
$$;

-- Recreate the policy using the security definer function
CREATE POLICY "Users can view accessible projects"
ON public.projects
FOR SELECT
USING (public.check_project_access(id, auth.uid()));

-- Remove the duplicate "Creators can view own projects" policy since it's now redundant
DROP POLICY IF EXISTS "Creators can view own projects" ON public.projects;
