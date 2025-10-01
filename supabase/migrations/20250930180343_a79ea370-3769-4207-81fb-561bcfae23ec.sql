-- =================== EXTENSIONS & UTILITIES ===================
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists btree_gin;

-- Helper function for updated_at
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin 
  new.updated_at := now(); 
  return new; 
end $$;

-- =================== ENUMS ===================
create type extraction_status as enum ('IN_PROGRESS','SUBMITTED','APPROVED','REJECTED');
create type assessment_status as enum ('in_progress','submitted','locked','archived');

-- =================== PROFILES TABLE ===================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "Users can view own profile"
  on profiles for select using (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);

-- Trigger to create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =================== PROJECTS & MEMBERS ===================
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name varchar(255) not null,
  description text,
  created_by_id uuid not null references profiles(id) on delete restrict,
  settings jsonb not null default jsonb_build_object('blind_mode', false),
  is_active boolean not null default true,
  review_title text,
  condition_studied varchar(255),
  review_rationale text,
  review_keywords jsonb not null default '[]'::jsonb,
  eligibility_criteria jsonb not null default '{}'::jsonb,
  study_design jsonb not null default '{}'::jsonb,
  review_context text,
  search_strategy text,
  risk_of_bias_instrument_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_projects_updated_at
  before update on projects for each row execute function set_updated_at();

create index idx_projects_active on projects(is_active);
create index idx_projects_created_by on projects(created_by_id);

alter table projects enable row level security;

create table if not exists project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role varchar(20) not null default 'reviewer',
  permissions jsonb not null default jsonb_build_object('can_export', false),
  invitation_email text,
  invitation_token text,
  invitation_sent_at timestamptz,
  invitation_accepted_at timestamptz,
  created_by_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_project_user unique (project_id, user_id)
);

create trigger trg_project_members_updated_at
  before update on project_members for each row execute function set_updated_at();

create index idx_project_members_project on project_members(project_id);
create index idx_project_members_user on project_members(user_id);
create index idx_project_members_role on project_members(role);

alter table project_members enable row level security;

-- RLS helper function
create or replace function is_project_member(p_project uuid, p_user uuid)
returns boolean language sql stable as $$
  select exists(
    select 1 from project_members
    where project_id = p_project and user_id = p_user
  );
$$;

create or replace function is_project_manager(p_project uuid, p_user uuid)
returns boolean language sql stable security definer as $$
  select exists(
    select 1 from project_members
    where project_id = p_project and user_id = p_user and role in ('lead','manager','admin')
  );
$$;

-- Project policies
create policy "Users can view projects they're members of"
  on projects for select using (
    exists (
      select 1 from project_members pm
      where pm.project_id = projects.id and pm.user_id = auth.uid()
    )
  );

create policy "Users can create projects"
  on projects for insert with check (auth.uid() = created_by_id);

create policy "Managers can update projects"
  on projects for update using (
    is_project_manager(id, auth.uid())
  );

-- Member policies
create policy "Members can view project members"
  on project_members for select using (
    is_project_member(project_id, auth.uid())
  );

create policy "Managers can manage members"
  on project_members for all using (
    is_project_manager(project_id, auth.uid())
  );

-- =================== ARTICLES ===================
create table if not exists articles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  abstract text,
  language varchar(20),
  publication_year int check (publication_year between 1600 and 2500),
  publication_month int check (publication_month between 1 and 12),
  publication_day int check (publication_day between 1 and 31),
  journal_title text,
  journal_issn varchar(20),
  journal_eissn varchar(20),
  journal_publisher text,
  volume varchar(30),
  issue varchar(30),
  pages varchar(50),
  article_type varchar(40),
  publication_status varchar(30),
  open_access boolean,
  license varchar(80),
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
  study_design varchar(50),
  registration jsonb default '{}'::jsonb,
  funding jsonb default '[]'::jsonb,
  conflicts_of_interest text,
  data_availability text,
  hash_fingerprint text,
  ingestion_source varchar(30),
  source_payload jsonb default '{}'::jsonb,
  row_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_articles_project_doi unique (project_id, doi) deferrable initially immediate
);

create trigger trg_articles_updated_at
  before update on articles for each row execute function set_updated_at();

create index idx_articles_project on articles(project_id);
create index idx_articles_biblio on articles(publication_year, journal_title);
create index idx_articles_idents on articles(doi, pmid, pmcid);
create index idx_articles_trgm_title on articles using gin (title gin_trgm_ops);
create index idx_articles_keywords on articles using gin (keywords);
create index idx_articles_mesh on articles using gin (mesh_terms);

alter table articles enable row level security;

create policy "Members can view project articles"
  on articles for select using (
    is_project_member(project_id, auth.uid())
  );

create policy "Members can manage articles"
  on articles for all using (
    is_project_member(project_id, auth.uid())
  );

create table if not exists article_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  article_id uuid not null references articles(id) on delete cascade,
  file_type varchar(20) not null,
  storage_key text not null,
  original_filename text,
  bytes bigint check (bytes is null or bytes >= 0),
  md5 text,
  extracted_text_key text,
  extracted_text_status varchar(20) default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_article_files_updated_at
  before update on article_files for each row execute function set_updated_at();

alter table article_files enable row level security;

create policy "Members can view article files"
  on article_files for select using (
    is_project_member(project_id, auth.uid())
  );

create policy "Members can manage article files"
  on article_files for all using (
    is_project_member(project_id, auth.uid())
  );

-- =================== EXTRACTION ===================
create table if not exists extraction_forms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  version int not null,
  schema jsonb not null,
  is_active boolean not null default true,
  created_by uuid not null references profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint uq_extraction_form unique (project_id, version)
);

alter table extraction_forms enable row level security;

create policy "Members can view extraction forms"
  on extraction_forms for select using (
    is_project_member(project_id, auth.uid())
  );

create policy "Managers can manage forms"
  on extraction_forms for all using (
    is_project_manager(project_id, auth.uid())
  );

create table if not exists extractions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  article_id uuid not null references articles(id) on delete cascade,
  form_id uuid not null references extraction_forms(id) on delete restrict,
  extractor_id uuid not null references profiles(id) on delete restrict,
  status extraction_status not null default 'IN_PROGRESS',
  data jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  notes text,
  row_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_extraction_once unique (project_id, article_id, form_id, extractor_id)
);

alter table extractions enable row level security;

create policy "Members can view extractions"
  on extractions for select using (
    is_project_member(project_id, auth.uid())
  );

create policy "Users can manage own extractions"
  on extractions for all using (
    is_project_member(project_id, auth.uid()) and 
    (extractor_id = auth.uid() or is_project_manager(project_id, auth.uid()))
  );

-- =================== ASSESSMENT ===================
create table if not exists assessment_instruments (
  id uuid primary key default gen_random_uuid(),
  tool_type varchar(30) not null,
  name varchar(255) not null,
  version varchar(50) not null,
  mode varchar(20) not null default 'human',
  is_active boolean not null default true,
  allowed_levels jsonb not null default '["low","high","unclear"]'::jsonb,
  aggregation_rules jsonb,
  schema jsonb,
  created_at timestamptz not null default now(),
  constraint uq_instrument unique (tool_type, version, mode)
);

alter table assessment_instruments enable row level security;

create policy "Everyone can view instruments"
  on assessment_instruments for select using (true);

create table if not exists assessment_items (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references assessment_instruments(id) on delete cascade,
  domain varchar(120) not null,
  item_code varchar(50) not null,
  question text not null,
  sort_order int not null,
  required boolean not null default true,
  allowed_levels_override jsonb,
  created_at timestamptz not null default now(),
  constraint uq_item_instrument_code unique (instrument_id, item_code)
);

alter table assessment_items enable row level security;

create policy "Everyone can view assessment items"
  on assessment_items for select using (true);

create table if not exists assessments (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  tool_type varchar(30) not null,
  instrument_id uuid references assessment_instruments(id) on delete set null,
  responses jsonb not null default '{}'::jsonb,
  overall_assessment jsonb,
  confidence_level int,
  status assessment_status not null default 'in_progress',
  completion_percentage numeric(5,2),
  version int not null default 1,
  is_current_version boolean not null default true,
  parent_assessment_id uuid references assessments(id) on delete set null,
  is_blind boolean not null default false,
  can_see_others boolean not null default true,
  comments jsonb not null default '[]'::jsonb,
  private_notes text,
  project_id uuid references projects(id) on delete set null,
  assessed_by_type varchar(20) not null default 'human',
  run_id uuid,
  row_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_assessment_article_user_tool_ver unique (article_id, user_id, tool_type, version)
);

create unique index uq_assessment_current_one
  on assessments(article_id, user_id, tool_type)
  where is_current_version is true;

alter table assessments enable row level security;

-- Blind mode policy
create policy "Members can view assessments with blind rules"
  on assessments for select using (
    exists (
      select 1 from project_members pm 
      where pm.project_id = assessments.project_id 
      and pm.user_id = auth.uid()
    )
    and (
      (select (settings->>'blind_mode')::boolean from projects where id = assessments.project_id) = false
      or (user_id = auth.uid())
      or (is_project_manager(assessments.project_id, auth.uid()))
    )
  );

create policy "Users can manage own assessments"
  on assessments for all using (
    exists (
      select 1 from project_members pm 
      where pm.project_id = assessments.project_id 
      and pm.user_id = auth.uid()
    )
    and (user_id = auth.uid() or is_project_manager(assessments.project_id, auth.uid()))
  );

-- =================== AUDIT LOG ===================
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid,
  actor uuid,
  action text not null,
  entity text,
  entity_id uuid,
  diff jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_project on audit_log(project_id);

alter table audit_log enable row level security;

create policy "Members can view audit log"
  on audit_log for select using (
    project_id is null or is_project_member(project_id, auth.uid())
  );