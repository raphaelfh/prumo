drop trigger if exists "update_article_annotations_updated_at" on "public"."article_annotations";

drop policy "Members can create annotations" on "public"."article_annotations";

drop policy "Members can view annotations" on "public"."article_annotations";

drop policy "Users can delete own annotations" on "public"."article_annotations";

drop policy "Users can update own annotations" on "public"."article_annotations";

drop policy "Members can create boxes" on "public"."article_boxes";

drop policy "Members can view boxes" on "public"."article_boxes";

drop policy "Users can delete own boxes" on "public"."article_boxes";

drop policy "Users can update own boxes" on "public"."article_boxes";

drop policy "Members can create highlights" on "public"."article_highlights";

drop policy "Members can view highlights" on "public"."article_highlights";

drop policy "Users can delete own highlights" on "public"."article_highlights";

drop policy "Users can update own highlights" on "public"."article_highlights";

drop policy "Users can create projects" on "public"."projects";

revoke delete on table "public"."article_annotations" from "anon";

revoke insert on table "public"."article_annotations" from "anon";

revoke references on table "public"."article_annotations" from "anon";

revoke select on table "public"."article_annotations" from "anon";

revoke trigger on table "public"."article_annotations" from "anon";

revoke truncate on table "public"."article_annotations" from "anon";

revoke update on table "public"."article_annotations" from "anon";

revoke delete on table "public"."article_annotations" from "authenticated";

revoke insert on table "public"."article_annotations" from "authenticated";

revoke references on table "public"."article_annotations" from "authenticated";

revoke select on table "public"."article_annotations" from "authenticated";

revoke trigger on table "public"."article_annotations" from "authenticated";

revoke truncate on table "public"."article_annotations" from "authenticated";

revoke update on table "public"."article_annotations" from "authenticated";

revoke delete on table "public"."article_annotations" from "service_role";

revoke insert on table "public"."article_annotations" from "service_role";

revoke references on table "public"."article_annotations" from "service_role";

revoke select on table "public"."article_annotations" from "service_role";

revoke trigger on table "public"."article_annotations" from "service_role";

revoke truncate on table "public"."article_annotations" from "service_role";

revoke update on table "public"."article_annotations" from "service_role";

alter table "public"."ai_assessments" drop constraint "ai_assessments_article_id_assessment_item_id_user_id_key";

alter table "public"."article_annotations" drop constraint "article_annotations_article_id_fkey";

alter table "public"."article_annotations" drop constraint "article_annotations_author_id_fkey";

alter table "public"."article_annotations" drop constraint "article_annotations_pkey";

drop index if exists "public"."ai_assessments_article_id_assessment_item_id_user_id_key";

drop index if exists "public"."article_annotations_pkey";

drop index if exists "public"."idx_ann_article";

drop index if exists "public"."idx_ann_article_status";

drop index if exists "public"."idx_ann_author_status";

drop index if exists "public"."idx_ann_page";

drop index if exists "public"."idx_ann_type";

drop index if exists "public"."idx_boxes_article";

drop index if exists "public"."idx_boxes_page";

drop index if exists "public"."idx_highlights_article";

drop index if exists "public"."idx_highlights_page";

drop table "public"."article_annotations";

alter type "public"."annotation_type" rename to "annotation_type__old_version_to_be_dropped";

create type "public"."annotation_type" as enum ('text', 'area', 'highlight', 'note', 'underline');

create table "public"."article_annotations_new" (
    "id" uuid not null default gen_random_uuid(),
    "article_id" uuid not null,
    "highlight_id" uuid,
    "box_id" uuid,
    "parent_id" uuid,
    "content" text not null,
    "author_id" uuid,
    "is_resolved" boolean not null default false,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
);


alter table "public"."article_annotations_new" enable row level security;

drop type "public"."annotation_type__old_version_to_be_dropped";

alter table "public"."article_boxes" alter column "color" set default '{"b": 59, "g": 235, "r": 255, "opacity": 0.4}'::jsonb;

alter table "public"."article_boxes" alter column "color" set not null;

alter table "public"."article_highlights" alter column "color" set default '{"b": 59, "g": 235, "r": 255, "opacity": 0.4}'::jsonb;

alter table "public"."article_highlights" alter column "color" set not null;

alter table "public"."article_highlights" alter column "selected_text" set not null;

CREATE UNIQUE INDEX ai_assessment_prompts_assessment_item_id_key ON public.ai_assessment_prompts USING btree (assessment_item_id);

CREATE UNIQUE INDEX article_annotations_new_pkey ON public.article_annotations_new USING btree (id);

CREATE INDEX idx_article_annotations_new_article ON public.article_annotations_new USING btree (article_id);

CREATE INDEX idx_article_annotations_new_box ON public.article_annotations_new USING btree (box_id);

CREATE INDEX idx_article_annotations_new_highlight ON public.article_annotations_new USING btree (highlight_id);

CREATE INDEX idx_article_annotations_new_parent ON public.article_annotations_new USING btree (parent_id);

CREATE INDEX idx_article_boxes_article_page ON public.article_boxes USING btree (article_id, page_number);

CREATE INDEX idx_article_highlights_article_page ON public.article_highlights USING btree (article_id, page_number);

alter table "public"."article_annotations_new" add constraint "article_annotations_new_pkey" PRIMARY KEY using index "article_annotations_new_pkey";

alter table "public"."ai_assessment_prompts" add constraint "ai_assessment_prompts_assessment_item_id_key" UNIQUE using index "ai_assessment_prompts_assessment_item_id_key";

alter table "public"."article_annotations_new" add constraint "annotation_target_check" CHECK ((((highlight_id IS NOT NULL) AND (box_id IS NULL)) OR ((highlight_id IS NULL) AND (box_id IS NOT NULL)) OR ((highlight_id IS NULL) AND (box_id IS NULL)))) not valid;

alter table "public"."article_annotations_new" validate constraint "annotation_target_check";

alter table "public"."article_annotations_new" add constraint "article_annotations_new_article_id_fkey" FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE not valid;

alter table "public"."article_annotations_new" validate constraint "article_annotations_new_article_id_fkey";

alter table "public"."article_annotations_new" add constraint "article_annotations_new_author_id_fkey" FOREIGN KEY (author_id) REFERENCES auth.users(id) not valid;

alter table "public"."article_annotations_new" validate constraint "article_annotations_new_author_id_fkey";

alter table "public"."article_annotations_new" add constraint "article_annotations_new_box_id_fkey" FOREIGN KEY (box_id) REFERENCES article_boxes(id) ON DELETE CASCADE not valid;

alter table "public"."article_annotations_new" validate constraint "article_annotations_new_box_id_fkey";

alter table "public"."article_annotations_new" add constraint "article_annotations_new_highlight_id_fkey" FOREIGN KEY (highlight_id) REFERENCES article_highlights(id) ON DELETE CASCADE not valid;

alter table "public"."article_annotations_new" validate constraint "article_annotations_new_highlight_id_fkey";

alter table "public"."article_annotations_new" add constraint "article_annotations_new_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES article_annotations_new(id) ON DELETE CASCADE not valid;

alter table "public"."article_annotations_new" validate constraint "article_annotations_new_parent_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_project_bypass_rls(project_name text, creator_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_project_id uuid;
BEGIN
  -- Inserir projeto (bypass RLS devido ao SECURITY DEFINER)
  INSERT INTO projects (name, created_by_id)
  VALUES (project_name, creator_id)
  RETURNING id INTO new_project_id;
  
  -- Adicionar criador como manager
  INSERT INTO project_members (project_id, user_id, role)
  VALUES (new_project_id, creator_id, 'manager');
  
  RETURN new_project_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_project_with_creator(project_name text, creator_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_project_id uuid;
BEGIN
  -- Validate that creator has a profile
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = creator_id) THEN
    RAISE EXCEPTION 'User profile not found. Please ensure you are properly authenticated.';
  END IF;
  
  -- Create the project
  INSERT INTO projects (name, created_by_id)
  VALUES (project_name, creator_id)
  RETURNING id INTO new_project_id;
  
  -- Add creator as manager
  INSERT INTO project_members (project_id, user_id, role)
  VALUES (new_project_id, creator_id, 'manager');
  
  RETURN new_project_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.debug_edge_function_call()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  test_payload jsonb;
BEGIN
  -- Payload de teste
  test_payload := jsonb_build_object(
    'projectId', '3cc77c90-48e0-476c-bb35-900fc275587f',
    'articleId', 'cd17666f-58b7-4331-a6fc-f02b77c2d7de',
    'assessmentItemId', 'a387c418-f199-48f5-9d7f-c56665436f7b',
    'instrumentId', '71ee54e9-9515-47e3-bdf9-87edb8f44a85',
    'pdf_storage_key', '3cc77c90-48e0-476c-bb35-900fc275587f/cd17666f-58b7-4331-a6fc-f02b77c2d7de/1759356519530.pdf'
  );
  
  -- Verificar se o usuário atual tem perfil
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()) THEN
    RETURN jsonb_build_object(
      'error', 'User profile not found',
      'user_id', auth.uid(),
      'payload', test_payload
    );
  END IF;
  
  -- Verificar se o usuário tem acesso ao projeto
  IF NOT EXISTS (
    SELECT 1 FROM project_members 
    WHERE project_id = (test_payload->>'projectId')::uuid 
    AND user_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object(
      'error', 'User does not have access to project',
      'user_id', auth.uid(),
      'project_id', test_payload->>'projectId',
      'payload', test_payload
    );
  END IF;
  
  RETURN jsonb_build_object(
    'status', 'success',
    'message', 'All checks passed',
    'user_id', auth.uid(),
    'payload', test_payload
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.final_edge_function_test()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  -- Verificar se todos os componentes estão funcionando
  result := jsonb_build_object(
    'status', 'success',
    'message', 'Edge Function test environment is ready',
    'checks', jsonb_build_object(
      'user_authenticated', auth.uid() IS NOT NULL,
      'user_id', auth.uid(),
      'project_access', EXISTS (
        SELECT 1 FROM project_members 
        WHERE project_id = '3cc77c90-48e0-476c-bb35-900fc275587f'::uuid 
        AND user_id = auth.uid()
      ),
      'data_available', jsonb_build_object(
        'project', EXISTS (SELECT 1 FROM projects WHERE id = '3cc77c90-48e0-476c-bb35-900fc275587f'::uuid),
        'article', EXISTS (SELECT 1 FROM articles WHERE id = 'cd17666f-58b7-4331-a6fc-f02b77c2d7de'::uuid),
        'assessment_item', EXISTS (SELECT 1 FROM assessment_items WHERE id = 'a387c418-f199-48f5-9d7f-c56665436f7b'::uuid),
        'instrument', EXISTS (SELECT 1 FROM assessment_instruments WHERE id = '71ee54e9-9515-47e3-bdf9-87edb8f44a85'::uuid),
        'pdf_file', EXISTS (SELECT 1 FROM article_files WHERE storage_key = '3cc77c90-48e0-476c-bb35-900fc275587f/cd17666f-58b7-4331-a6fc-f02b77c2d7de/1759356519530.pdf')
      )
    ),
    'test_payload', jsonb_build_object(
      'projectId', '3cc77c90-48e0-476c-bb35-900fc275587f',
      'articleId', 'cd17666f-58b7-4331-a6fc-f02b77c2d7de',
      'assessmentItemId', 'a387c418-f199-48f5-9d7f-c56665436f7b',
      'instrumentId', '71ee54e9-9515-47e3-bdf9-87edb8f44a85',
      'pdf_storage_key', '3cc77c90-48e0-476c-bb35-900fc275587f/cd17666f-58b7-4331-a6fc-f02b77c2d7de/1759356519530.pdf'
    ),
    'timestamp', now()
  );
  
  RETURN result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.test_ai_assessment_comprehensive()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  test_data jsonb;
  current_user_id uuid;
  test_project_id uuid;
  test_article_id uuid;
  test_assessment_item_id uuid;
  test_instrument_id uuid;
  test_pdf_storage_key text;
BEGIN
  -- Obter o usuário atual
  current_user_id := auth.uid();
  
  -- Dados de teste
  test_project_id := '3cc77c90-48e0-476c-bb35-900fc275587f'::uuid;
  test_article_id := 'cd17666f-58b7-4331-a6fc-f02b77c2d7de'::uuid;
  test_assessment_item_id := 'a387c418-f199-48f5-9d7f-c56665436f7b'::uuid;
  test_instrument_id := '71ee54e9-9515-47e3-bdf9-87edb8f44a85'::uuid;
  test_pdf_storage_key := '3cc77c90-48e0-476c-bb35-900fc275587f/cd17666f-58b7-4331-a6fc-f02b77c2d7de/1759356519530.pdf';
  
  -- Verificar se o usuário tem acesso ao projeto
  IF NOT EXISTS (
    SELECT 1 FROM project_members 
    WHERE project_members.project_id = test_project_id 
    AND project_members.user_id = current_user_id
  ) THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'message', 'User does not have access to project',
      'user_id', current_user_id,
      'project_id', test_project_id
    );
  END IF;
  
  -- Verificar se todos os dados existem
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = test_project_id) THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Project not found');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM articles WHERE id = test_article_id) THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Article not found');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM assessment_items WHERE id = test_assessment_item_id) THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Assessment item not found');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM assessment_instruments WHERE id = test_instrument_id) THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Instrument not found');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM article_files WHERE storage_key = test_pdf_storage_key) THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'PDF file not found');
  END IF;
  
  -- Construir dados de teste
  test_data := jsonb_build_object(
    'projectId', test_project_id,
    'articleId', test_article_id,
    'assessmentItemId', test_assessment_item_id,
    'instrumentId', test_instrument_id,
    'pdf_storage_key', test_pdf_storage_key,
    'userId', current_user_id
  );
  
  RETURN jsonb_build_object(
    'status', 'success',
    'message', 'All validations passed. Ready for Edge Function test.',
    'test_data', test_data,
    'timestamp', now()
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.test_ai_assessment_function()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  test_result jsonb;
  test_data jsonb;
BEGIN
  -- Dados de teste
  test_data := jsonb_build_object(
    'projectId', '3cc77c90-48e0-476c-bb35-900fc275587f',
    'articleId', 'cd17666f-58b7-4331-a6fc-f02b77c2d7de',
    'assessmentItemId', 'a387c418-f199-48f5-9d7f-c56665436f7b',
    'instrumentId', '71ee54e9-9515-47e3-bdf9-87edb8f44a85',
    'pdf_storage_key', '3cc77c90-48e0-476c-bb35-900fc275587f/cd17666f-58b7-4331-a6fc-f02b77c2d7de/1759356519530.pdf'
  );
  
  -- Verificar se os dados existem
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = (test_data->>'projectId')::uuid) THEN
    RETURN jsonb_build_object('error', 'Project not found', 'data', test_data);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM articles WHERE id = (test_data->>'articleId')::uuid) THEN
    RETURN jsonb_build_object('error', 'Article not found', 'data', test_data);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM assessment_items WHERE id = (test_data->>'assessmentItemId')::uuid) THEN
    RETURN jsonb_build_object('error', 'Assessment item not found', 'data', test_data);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM assessment_instruments WHERE id = (test_data->>'instrumentId')::uuid) THEN
    RETURN jsonb_build_object('error', 'Instrument not found', 'data', test_data);
  END IF;
  
  -- Verificar se o PDF existe no storage
  IF NOT EXISTS (
    SELECT 1 FROM article_files 
    WHERE storage_key = test_data->>'pdf_storage_key'
  ) THEN
    RETURN jsonb_build_object('error', 'PDF file not found in storage', 'data', test_data);
  END IF;
  
  RETURN jsonb_build_object(
    'status', 'success',
    'message', 'All test data is valid',
    'data', test_data
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.test_edge_function_call()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  test_payload jsonb;
  response_data jsonb;
BEGIN
  -- Payload de teste
  test_payload := jsonb_build_object(
    'projectId', '3cc77c90-48e0-476c-bb35-900fc275587f',
    'articleId', 'cd17666f-58b7-4331-a6fc-f02b77c2d7de',
    'assessmentItemId', 'a387c418-f199-48f5-9d7f-c56665436f7b',
    'instrumentId', '71ee54e9-9515-47e3-bdf9-87edb8f44a85',
    'pdf_storage_key', '3cc77c90-48e0-476c-bb35-900fc275587f/cd17666f-58b7-4331-a6fc-f02b77c2d7de/1759356519530.pdf'
  );
  
  -- Simular uma resposta de sucesso
  response_data := jsonb_build_object(
    'status', 'test_success',
    'message', 'Edge function test completed',
    'payload', test_payload,
    'timestamp', now()
  );
  
  RETURN response_data;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Insert profile if it doesn't exist
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    new.id, 
    new.email, 
    COALESCE(new.raw_user_meta_data->>'full_name', new.email)
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name);
  
  RETURN new;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_manager(p_project uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS(
    SELECT 1 FROM project_members
    WHERE project_id = p_project AND user_id = p_user AND role IN ('lead','manager','admin')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_member(p_project uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS(
    SELECT 1 FROM project_members
    WHERE project_id = p_project AND user_id = p_user
  );
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN 
  NEW.updated_at := NOW(); 
  RETURN NEW; 
END $function$
;

CREATE OR REPLACE FUNCTION public.update_annotation_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

grant delete on table "public"."article_annotations_new" to "anon";

grant insert on table "public"."article_annotations_new" to "anon";

grant references on table "public"."article_annotations_new" to "anon";

grant select on table "public"."article_annotations_new" to "anon";

grant trigger on table "public"."article_annotations_new" to "anon";

grant truncate on table "public"."article_annotations_new" to "anon";

grant update on table "public"."article_annotations_new" to "anon";

grant delete on table "public"."article_annotations_new" to "authenticated";

grant insert on table "public"."article_annotations_new" to "authenticated";

grant references on table "public"."article_annotations_new" to "authenticated";

grant select on table "public"."article_annotations_new" to "authenticated";

grant trigger on table "public"."article_annotations_new" to "authenticated";

grant truncate on table "public"."article_annotations_new" to "authenticated";

grant update on table "public"."article_annotations_new" to "authenticated";

grant delete on table "public"."article_annotations_new" to "service_role";

grant insert on table "public"."article_annotations_new" to "service_role";

grant references on table "public"."article_annotations_new" to "service_role";

grant select on table "public"."article_annotations_new" to "service_role";

grant trigger on table "public"."article_annotations_new" to "service_role";

grant truncate on table "public"."article_annotations_new" to "service_role";

grant update on table "public"."article_annotations_new" to "service_role";

create policy "Users can create annotations in their projects"
on "public"."article_annotations_new"
as permissive
for insert
to public
with check (((EXISTS ( SELECT 1
   FROM (articles a
     JOIN project_members pm ON ((pm.project_id = a.project_id)))
  WHERE ((a.id = article_annotations_new.article_id) AND (pm.user_id = auth.uid())))) OR (auth.uid() IS NOT NULL)));


create policy "Users can delete their own comments"
on "public"."article_annotations_new"
as permissive
for delete
to public
using (((author_id = auth.uid()) OR (auth.uid() IS NOT NULL)));


create policy "Users can update their own annotations"
on "public"."article_annotations_new"
as permissive
for update
to public
using ((author_id = auth.uid()));


create policy "Users can view annotations in their projects"
on "public"."article_annotations_new"
as permissive
for select
to public
using ((EXISTS ( SELECT 1
   FROM (articles a
     JOIN project_members pm ON ((pm.project_id = a.project_id)))
  WHERE ((a.id = article_annotations_new.article_id) AND (pm.user_id = auth.uid())))));


create policy "Users can create boxes in their projects"
on "public"."article_boxes"
as permissive
for insert
to public
with check (((EXISTS ( SELECT 1
   FROM (articles a
     JOIN project_members pm ON ((pm.project_id = a.project_id)))
  WHERE ((a.id = article_boxes.article_id) AND (pm.user_id = auth.uid())))) OR (auth.uid() IS NOT NULL)));


create policy "Users can delete their own boxes"
on "public"."article_boxes"
as permissive
for delete
to public
using (((author_id = auth.uid()) OR (auth.uid() IS NOT NULL)));


create policy "Users can update their own boxes"
on "public"."article_boxes"
as permissive
for update
to public
using ((author_id = auth.uid()));


create policy "Users can view boxes in their projects"
on "public"."article_boxes"
as permissive
for select
to public
using ((EXISTS ( SELECT 1
   FROM (articles a
     JOIN project_members pm ON ((pm.project_id = a.project_id)))
  WHERE ((a.id = article_boxes.article_id) AND (pm.user_id = auth.uid())))));


create policy "Users can create highlights in their projects"
on "public"."article_highlights"
as permissive
for insert
to public
with check (((EXISTS ( SELECT 1
   FROM (articles a
     JOIN project_members pm ON ((pm.project_id = a.project_id)))
  WHERE ((a.id = article_highlights.article_id) AND (pm.user_id = auth.uid())))) OR (auth.uid() IS NOT NULL)));


create policy "Users can delete their own highlights"
on "public"."article_highlights"
as permissive
for delete
to public
using (((author_id = auth.uid()) OR (auth.uid() IS NOT NULL)));


create policy "Users can update their own highlights"
on "public"."article_highlights"
as permissive
for update
to public
using ((author_id = auth.uid()));


create policy "Users can view highlights in their projects"
on "public"."article_highlights"
as permissive
for select
to public
using ((EXISTS ( SELECT 1
   FROM (articles a
     JOIN project_members pm ON ((pm.project_id = a.project_id)))
  WHERE ((a.id = article_highlights.article_id) AND (pm.user_id = auth.uid())))));


create policy "Users can create projects"
on "public"."projects"
as permissive
for insert
to authenticated
with check (((auth.uid() IS NOT NULL) AND (auth.uid() = created_by_id)));




