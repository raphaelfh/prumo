-- =====================================================
-- MIGRATION: Feedback Reports
-- =====================================================
-- Descrição: Cria tabela para feedback de usuários:
-- feedback_reports
-- =====================================================

-- =================== FEEDBACK REPORTS ===================

CREATE TABLE feedback_reports (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  type text NOT NULL CHECK (type = ANY (ARRAY['bug'::text, 'suggestion'::text, 'question'::text, 'other'::text])),
  description text NOT NULL CHECK (char_length(description) >= 10),
  severity text CHECK (severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])),
  url text NOT NULL,
  user_agent text,
  viewport_size jsonb,
  project_id uuid,
  article_id uuid,
  screenshot_url text,
  status text DEFAULT 'open'::text CHECK (status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'wont_fix'::text, 'duplicate'::text])),
  priority integer DEFAULT 0,
  admin_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT feedback_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT feedback_reports_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  CONSTRAINT feedback_reports_article_id_fkey FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL
);

COMMENT ON TABLE feedback_reports IS 'Armazena feedback de usuários (bugs, sugestões, perguntas) com contexto técnico automático';
COMMENT ON COLUMN feedback_reports.type IS 'Tipo de feedback: bug, suggestion, question, other';
COMMENT ON COLUMN feedback_reports.severity IS 'Severidade (apenas para bugs): low, medium, high, critical';
COMMENT ON COLUMN feedback_reports.viewport_size IS 'Dimensões da tela do usuário em formato JSON';
COMMENT ON COLUMN feedback_reports.status IS 'Status do feedback: open, in_progress, resolved, wont_fix, duplicate';

