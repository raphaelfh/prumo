-- =====================================================
-- MIGRATION: Triggers
-- =====================================================
-- Descrição: Cria todos os triggers necessários
-- =====================================================

-- =================== TRIGGER: CREATE PROFILE ON SIGNUP ===================

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- NOTA: Não é possível comentar triggers no schema auth.users por limitações de permissão
-- O trigger cria automaticamente um profile quando um novo usuário é criado

-- =================== TRIGGERS: UPDATED_AT ===================

-- Profiles
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Projects
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Project Members
CREATE TRIGGER trg_project_members_updated_at
  BEFORE UPDATE ON project_members
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Articles
CREATE TRIGGER trg_articles_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Article Files
CREATE TRIGGER trg_article_files_updated_at
  BEFORE UPDATE ON article_files
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Article Highlights
CREATE TRIGGER trg_article_highlights_updated_at
  BEFORE UPDATE ON article_highlights
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Article Boxes
CREATE TRIGGER trg_article_boxes_updated_at
  BEFORE UPDATE ON article_boxes
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Article Annotations
CREATE TRIGGER trg_article_annotations_updated_at
  BEFORE UPDATE ON article_annotations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Extraction Templates Global
CREATE TRIGGER trg_extraction_templates_global_updated_at
  BEFORE UPDATE ON extraction_templates_global
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Project Extraction Templates
CREATE TRIGGER trg_project_extraction_templates_updated_at
  BEFORE UPDATE ON project_extraction_templates
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Extraction Instances
CREATE TRIGGER trg_extraction_instances_updated_at
  BEFORE UPDATE ON extraction_instances
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Extracted Values
CREATE TRIGGER trg_extracted_values_updated_at
  BEFORE UPDATE ON extracted_values
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Assessments
CREATE TRIGGER trg_assessments_updated_at
  BEFORE UPDATE ON assessments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- AI Assessment Configs
CREATE TRIGGER trg_ai_assessment_configs_updated_at
  BEFORE UPDATE ON ai_assessment_configs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- AI Assessment Prompts
CREATE TRIGGER trg_ai_assessment_prompts_updated_at
  BEFORE UPDATE ON ai_assessment_prompts
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- AI Assessments
CREATE TRIGGER trg_ai_assessments_updated_at
  BEFORE UPDATE ON ai_assessments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Zotero Integrations
CREATE TRIGGER trg_zotero_integrations_updated_at
  BEFORE UPDATE ON zotero_integrations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Feedback Reports
CREATE TRIGGER trg_feedback_reports_updated_at
  BEFORE UPDATE ON feedback_reports
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

