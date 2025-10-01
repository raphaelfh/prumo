-- Drop problematic policies for articles
DROP POLICY IF EXISTS "Members can manage articles" ON public.articles;
DROP POLICY IF EXISTS "Members can view project articles" ON public.articles;

-- Drop problematic policies for article_files
DROP POLICY IF EXISTS "Members can manage article files" ON public.article_files;
DROP POLICY IF EXISTS "Members can view article files" ON public.article_files;

-- Create security definer functions to avoid recursion
CREATE OR REPLACE FUNCTION public.can_access_article(p_project_id uuid, p_user_id uuid)
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

CREATE OR REPLACE FUNCTION public.can_manage_article(p_project_id uuid, p_user_id uuid)
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

-- Recreate policies for articles using security definer functions
CREATE POLICY "Members can view articles"
ON public.articles
FOR SELECT
USING (public.can_access_article(project_id, auth.uid()));

CREATE POLICY "Members can insert articles"
ON public.articles
FOR INSERT
WITH CHECK (public.can_manage_article(project_id, auth.uid()));

CREATE POLICY "Members can update articles"
ON public.articles
FOR UPDATE
USING (public.can_manage_article(project_id, auth.uid()));

CREATE POLICY "Members can delete articles"
ON public.articles
FOR DELETE
USING (public.can_manage_article(project_id, auth.uid()));

-- Recreate policies for article_files using security definer functions
CREATE POLICY "Members can view article files"
ON public.article_files
FOR SELECT
USING (public.can_access_article(project_id, auth.uid()));

CREATE POLICY "Members can insert article files"
ON public.article_files
FOR INSERT
WITH CHECK (public.can_manage_article(project_id, auth.uid()));

CREATE POLICY "Members can update article files"
ON public.article_files
FOR UPDATE
USING (public.can_manage_article(project_id, auth.uid()));

CREATE POLICY "Members can delete article files"
ON public.article_files
FOR DELETE
USING (public.can_manage_article(project_id, auth.uid()));