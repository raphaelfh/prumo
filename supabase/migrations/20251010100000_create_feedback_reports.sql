-- Tabela para armazenar feedback de usuários (bugs, sugestões, perguntas)
-- Estrutura escalável e preparada para expansão futura

CREATE TABLE feedback_reports (
  -- Identificadores
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users,  -- Nullable para permitir feedback de não logados
  
  -- Conteúdo do feedback
  type TEXT NOT NULL CHECK (type IN ('bug', 'suggestion', 'question', 'other')),
  description TEXT NOT NULL CHECK (char_length(description) >= 10),
  severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  
  -- Contexto técnico (captura automática pelo frontend)
  url TEXT NOT NULL,
  user_agent TEXT,
  viewport_size JSONB,  -- {width: 1920, height: 1080}
  
  -- Contexto da aplicação (opcional, capturado se disponível)
  project_id UUID REFERENCES projects ON DELETE SET NULL,
  article_id UUID REFERENCES articles ON DELETE SET NULL,
  
  -- Campos para expansão futura
  screenshot_url TEXT,  -- Path no Storage quando implementar screenshot
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'wont_fix', 'duplicate')),
  priority INTEGER DEFAULT 0,  -- Para ordenação interna (0 = normal)
  admin_notes TEXT,  -- Notas internas da equipe
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance em queries futuras
CREATE INDEX idx_feedback_user ON feedback_reports(user_id);
CREATE INDEX idx_feedback_status ON feedback_reports(status);
CREATE INDEX idx_feedback_type ON feedback_reports(type);
CREATE INDEX idx_feedback_created ON feedback_reports(created_at DESC);
CREATE INDEX idx_feedback_priority ON feedback_reports(priority DESC, created_at DESC);

-- Trigger para atualizar updated_at automaticamente
CREATE TRIGGER update_feedback_updated_at
  BEFORE UPDATE ON feedback_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS)
ALTER TABLE feedback_reports ENABLE ROW LEVEL SECURITY;

-- Política: Qualquer um pode criar feedback (logado ou não)
CREATE POLICY "Anyone can create feedback"
  ON feedback_reports FOR INSERT
  WITH CHECK (true);

-- Política: Usuários logados veem apenas seus próprios feedbacks
CREATE POLICY "Users can view own feedback"
  ON feedback_reports FOR SELECT
  USING (
    auth.uid() = user_id 
    OR user_id IS NULL
  );

-- Política: Apenas admins podem atualizar feedbacks (para futuro dashboard admin)
-- Por enquanto comentada, descomentar quando tiver campo role na tabela profiles
-- CREATE POLICY "Admins can update feedback"
--   ON feedback_reports FOR UPDATE
--   USING (
--     EXISTS (
--       SELECT 1 FROM profiles
--       WHERE profiles.id = auth.uid()
--       AND profiles.role = 'admin'
--     )
--   );

-- Comentários para documentação
COMMENT ON TABLE feedback_reports IS 'Armazena feedback de usuários (bugs, sugestões, perguntas) com contexto técnico automático';
COMMENT ON COLUMN feedback_reports.type IS 'Tipo de feedback: bug, suggestion, question, other';
COMMENT ON COLUMN feedback_reports.severity IS 'Severidade (apenas para bugs): low, medium, high, critical';
COMMENT ON COLUMN feedback_reports.viewport_size IS 'Dimensões da tela do usuário em formato JSON';
COMMENT ON COLUMN feedback_reports.status IS 'Status do feedback: open, in_progress, resolved, wont_fix, duplicate';

