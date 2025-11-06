-- =====================================================
-- MIGRATION: Core Tables
-- =====================================================
-- Descrição: Cria tabelas principais: profiles, projects, 
-- project_members, articles, article_files
-- =====================================================

-- =================== PROFILES ===================

CREATE TABLE profiles (
  id uuid NOT NULL PRIMARY KEY,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE profiles IS 'Perfis de usuários do sistema';
COMMENT ON COLUMN profiles.id IS 'ID do usuário (FK para auth.users)';

-- =================== PROJECTS ===================

CREATE TABLE projects (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  name character varying NOT NULL,
  description text,
  created_by_id uuid NOT NULL,
  settings jsonb NOT NULL DEFAULT jsonb_build_object('blind_mode', false),
  is_active boolean NOT NULL DEFAULT true,
  review_title text,
  condition_studied character varying,
  review_rationale text,
  review_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  eligibility_criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  study_design jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_context text,
  search_strategy text,
  risk_of_bias_instrument_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  picots_config_ai_review jsonb DEFAULT jsonb_build_object(
    'population', '',
    'index_models', '',
    'comparator_models', '',
    'outcomes', '',
    'timing', jsonb_build_object('prediction_moment', '', 'prediction_horizon', ''),
    'setting_and_intended_use', ''
  ),
  review_type review_type DEFAULT 'interventional'::review_type,
  assessment_scope character varying DEFAULT 'article'::character varying 
    CHECK (assessment_scope::text = ANY (ARRAY['article'::character varying, 'extraction_instance'::character varying]::text[])),
  assessment_entity_type_id uuid,
  CONSTRAINT projects_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES profiles(id) ON DELETE RESTRICT
);

-- FK para assessment_entity_type_id será criada depois que extraction_entity_types existir
-- Será adicionada na migration 0005_extraction_templates.sql

COMMENT ON TABLE projects IS 'Projetos de revisão sistemática';
COMMENT ON COLUMN projects.review_type IS 'Tipo de revisão (interventional, predictive_model, etc.)';
COMMENT ON COLUMN projects.assessment_scope IS 'Escopo da avaliação: article ou extraction_instance';

-- =================== PROJECT MEMBERS ===================

CREATE TABLE project_members (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role project_member_role NOT NULL DEFAULT 'reviewer'::project_member_role,
  permissions jsonb NOT NULL DEFAULT jsonb_build_object('can_export', false),
  invitation_email text,
  invitation_token text,
  invitation_sent_at timestamptz,
  invitation_accepted_at timestamptz,
  created_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT project_members_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT uq_project_user UNIQUE (project_id, user_id)
);

COMMENT ON TABLE project_members IS 'Membros de projetos com seus papéis e permissões';
COMMENT ON COLUMN project_members.role IS 'Papel do membro no projeto';

-- =================== RLS HELPER FUNCTIONS ===================
-- Funções auxiliares para Row Level Security que dependem das tabelas acima

-- Função para verificar se usuário é membro de um projeto
CREATE OR REPLACE FUNCTION is_project_member(p_project uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM project_members
    WHERE project_id = p_project AND user_id = p_user
  ) OR EXISTS(
    SELECT 1 FROM projects
    WHERE id = p_project AND created_by_id = p_user
  );
$$;

COMMENT ON FUNCTION is_project_member(uuid, uuid) IS 
'Verifica se um usuário é membro de um projeto (via project_members ou como criador)';

-- Função para verificar se usuário é manager de um projeto
CREATE OR REPLACE FUNCTION is_project_manager(p_project uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM project_members
    WHERE project_id = p_project 
      AND user_id = p_user 
      AND role = 'manager'
  ) OR EXISTS(
    SELECT 1 FROM projects
    WHERE id = p_project AND created_by_id = p_user
  );
$$;

COMMENT ON FUNCTION is_project_manager(uuid, uuid) IS 
'Verifica se um usuário é manager/lead/admin de um projeto (via project_members ou como criador)';

-- =================== ARTICLES ===================

CREATE TABLE articles (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  title text NOT NULL,
  abstract text,
  language character varying,
  publication_year integer CHECK (publication_year >= 1600 AND publication_year <= 2500),
  publication_month integer CHECK (publication_month >= 1 AND publication_month <= 12),
  publication_day integer CHECK (publication_day >= 1 AND publication_day <= 31),
  journal_title text,
  journal_issn character varying,
  journal_eissn character varying,
  journal_publisher text,
  volume character varying,
  issue character varying,
  pages character varying,
  article_type character varying,
  publication_status character varying,
  open_access boolean,
  license character varying,
  doi text,
  pmid text,
  pmcid text,
  arxiv_id text,
  pii text,
  keywords text[],
  authors text[],
  mesh_terms text[],
  url_landing text,
  url_pdf text,
  study_design character varying,
  registration jsonb DEFAULT '{}'::jsonb,
  funding jsonb DEFAULT '[]'::jsonb,
  conflicts_of_interest text,
  data_availability text,
  hash_fingerprint text,
  ingestion_source character varying,
  source_payload jsonb DEFAULT '{}'::jsonb,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  zotero_item_key text,
  zotero_collection_key text,
  zotero_version integer,
  CONSTRAINT articles_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

COMMENT ON TABLE articles IS 'Artigos científicos incluídos nos projetos';
COMMENT ON COLUMN articles.zotero_item_key IS 'Chave única do item no Zotero para tracking';
COMMENT ON COLUMN articles.zotero_collection_key IS 'Collection de origem no Zotero';
COMMENT ON COLUMN articles.zotero_version IS 'Versão do item no Zotero para detectar atualizações';

-- =================== ARTICLE FILES ===================

CREATE TABLE article_files (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  article_id uuid NOT NULL,
  file_type character varying NOT NULL,
  storage_key text NOT NULL,
  original_filename text,
  bytes bigint CHECK (bytes IS NULL OR bytes >= 0),
  md5 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  file_role file_role DEFAULT 'MAIN'::file_role 
    CHECK (file_role IS NULL OR file_role = ANY (ARRAY[
      'MAIN'::file_role, 
      'SUPPLEMENT'::file_role, 
      'PROTOCOL'::file_role, 
      'DATASET'::file_role, 
      'APPENDIX'::file_role, 
      'FIGURE'::file_role, 
      'OTHER'::file_role
    ])),
  text_raw text,
  text_html text,
  extraction_status character varying DEFAULT 'pending'::character varying,
  extraction_error text,
  extracted_at timestamptz,
  CONSTRAINT article_files_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT article_files_article_id_fkey FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

COMMENT ON TABLE article_files IS 'Arquivos PDF e outros documentos associados aos artigos';
COMMENT ON COLUMN article_files.file_role IS 'Papel do arquivo (MAIN, SUPPLEMENT, etc.)';
COMMENT ON COLUMN article_files.text_raw IS 'Texto extraído do PDF (raw)';
COMMENT ON COLUMN article_files.text_html IS 'Texto extraído do PDF (HTML formatado)';
COMMENT ON COLUMN article_files.extraction_status IS 'Status da extração de texto';

