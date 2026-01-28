-- =====================================================
-- MIGRATION: Assessment Restructure (Extraction Pattern)
-- =====================================================
-- Descrição: Reestrutura o módulo de assessment para seguir
-- o mesmo padrão arquitetural do módulo de extraction:
-- - assessment_instances (análogo a extraction_instances)
-- - assessment_responses (análogo a extracted_values)
-- - assessment_evidence (análogo a extraction_evidence)
--
-- Objetivo: Alinhar assessment com extraction para:
-- 1. Granularidade: 1 linha por resposta (não JSONB flat)
-- 2. Hierarquia: Suporte nativo para PROBAST por modelo
-- 3. Rastreabilidade: Queries SQL diretas
-- 4. Consistência: DRY + KISS
--
-- Referência: docs/ASSESSMENT_REFACTORING_SUMMARY.md
-- =====================================================

-- =================== ENUMS ===================

-- Enum para origem da resposta (human/ai/consensus)
CREATE TYPE assessment_source AS ENUM ('human', 'ai', 'consensus');

COMMENT ON TYPE assessment_source IS 'Origem da resposta de assessment (humano, IA ou consenso)';

-- =================== TABELA: assessment_instances ===================

CREATE TABLE assessment_instances (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FKs principais
  project_id uuid NOT NULL,
  article_id uuid NOT NULL,
  instrument_id uuid NOT NULL,

  -- Vinculação a extraction (para PROBAST por modelo)
  extraction_instance_id uuid NULL,

  -- Hierarquia (parent-child)
  parent_instance_id uuid NULL,

  -- Metadados da instance
  label character varying NOT NULL,
  status assessment_status NOT NULL DEFAULT 'in_progress'::assessment_status,
  reviewer_id uuid NOT NULL,

  -- Modo cego
  is_blind boolean NOT NULL DEFAULT false,
  can_see_others boolean NOT NULL DEFAULT true,

  -- Metadados flexíveis
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT assessment_instances_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,

  CONSTRAINT assessment_instances_article_id_fkey
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,

  CONSTRAINT assessment_instances_instrument_id_fkey
    FOREIGN KEY (instrument_id) REFERENCES assessment_instruments(id) ON DELETE RESTRICT,

  CONSTRAINT assessment_instances_extraction_instance_id_fkey
    FOREIGN KEY (extraction_instance_id) REFERENCES extraction_instances(id) ON DELETE SET NULL,

  CONSTRAINT assessment_instances_parent_instance_id_fkey
    FOREIGN KEY (parent_instance_id) REFERENCES assessment_instances(id) ON DELETE CASCADE,

  CONSTRAINT assessment_instances_reviewer_id_fkey
    FOREIGN KEY (reviewer_id) REFERENCES profiles(id) ON DELETE RESTRICT,

  -- Validação: extraction_instance_id só pode existir em root instances (sem parent)
  CONSTRAINT chk_extraction_instance_scope CHECK (
    (extraction_instance_id IS NULL) OR
    (extraction_instance_id IS NOT NULL AND parent_instance_id IS NULL)
  )
);

COMMENT ON TABLE assessment_instances IS 'Instâncias de avaliação (PROBAST por artigo ou por modelo). Análogo a extraction_instances.';
COMMENT ON COLUMN assessment_instances.extraction_instance_id IS 'FK para extraction_instance quando assessment_scope = extraction_instance (ex: PROBAST vinculado a um modelo específico)';
COMMENT ON COLUMN assessment_instances.parent_instance_id IS 'Permite hierarquia (ex: PROBAST root → Domain instances). Análogo a extraction_instances.parent_instance_id';
COMMENT ON COLUMN assessment_instances.label IS 'Rótulo da instance (ex: "PROBAST - Model A", "Domain 1: Participants")';
COMMENT ON COLUMN assessment_instances.reviewer_id IS 'Revisor responsável por esta avaliação';
COMMENT ON COLUMN assessment_instances.metadata IS 'Metadados flexíveis (ex: overall_risk, applicability_concerns, custom fields)';

-- =================== TABELA: assessment_responses ===================

CREATE TABLE assessment_responses (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FKs principais (denormalização intencional para performance e RLS)
  project_id uuid NOT NULL,
  article_id uuid NOT NULL,

  -- Vinculação à instance e item
  assessment_instance_id uuid NOT NULL,
  assessment_item_id uuid NOT NULL,

  -- Resposta do revisor
  selected_level character varying NOT NULL,
  notes text NULL,
  confidence numeric(3,2) NULL CHECK (confidence >= 0 AND confidence <= 1),

  -- Origem da resposta (human/ai/consensus)
  source assessment_source NOT NULL DEFAULT 'human'::assessment_source,

  -- Sugestão de IA (se aplicável)
  confidence_score numeric(3,2) NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  ai_suggestion_id uuid NULL,

  -- Revisor
  reviewer_id uuid NOT NULL,

  -- Consenso
  is_consensus boolean NOT NULL DEFAULT false,

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT assessment_responses_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,

  CONSTRAINT assessment_responses_article_id_fkey
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,

  CONSTRAINT assessment_responses_assessment_instance_id_fkey
    FOREIGN KEY (assessment_instance_id) REFERENCES assessment_instances(id) ON DELETE CASCADE,

  CONSTRAINT assessment_responses_assessment_item_id_fkey
    FOREIGN KEY (assessment_item_id) REFERENCES assessment_items(id) ON DELETE RESTRICT,

  CONSTRAINT assessment_responses_reviewer_id_fkey
    FOREIGN KEY (reviewer_id) REFERENCES profiles(id) ON DELETE RESTRICT,

  CONSTRAINT assessment_responses_ai_suggestion_id_fkey
    FOREIGN KEY (ai_suggestion_id) REFERENCES ai_assessments(id) ON DELETE SET NULL,

  -- Unique constraint: 1 resposta por item por instance
  CONSTRAINT uq_assessment_instance_item UNIQUE (assessment_instance_id, assessment_item_id)
);

COMMENT ON TABLE assessment_responses IS 'Respostas individuais aos itens de avaliação. Análogo a extracted_values.';
COMMENT ON COLUMN assessment_responses.selected_level IS 'Nível selecionado pelo revisor (ex: "Low", "High", "Unclear", "Yes", "No")';
COMMENT ON COLUMN assessment_responses.notes IS 'Notas/justificativa do revisor para esta resposta';
COMMENT ON COLUMN assessment_responses.confidence IS 'Confiança do revisor na resposta (0.0-1.0)';
COMMENT ON COLUMN assessment_responses.source IS 'Origem da resposta: human (manual), ai (aceita de sugestão), consensus (após resolução)';
COMMENT ON COLUMN assessment_responses.confidence_score IS 'Score de confiança da IA (quando source = ai)';
COMMENT ON COLUMN assessment_responses.ai_suggestion_id IS 'FK para ai_assessments quando resposta foi aceita de sugestão de IA';
COMMENT ON COLUMN assessment_responses.is_consensus IS 'Indica se é a resposta consensual final após resolução de conflitos';
COMMENT ON CONSTRAINT uq_assessment_instance_item ON assessment_responses IS 'Garante que cada item tem no máximo 1 resposta por instance (1 revisor pode dar 1 resposta por item)';

-- =================== TABELA: assessment_evidence ===================

CREATE TABLE assessment_evidence (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FKs principais
  project_id uuid NOT NULL,
  article_id uuid NOT NULL,

  -- Alvo da evidência (response ou instance)
  target_type character varying NOT NULL
    CHECK (target_type::text IN ('response', 'instance')),
  target_id uuid NOT NULL,

  -- Evidência do PDF
  article_file_id uuid NULL,
  page_number integer NULL CHECK (page_number IS NULL OR page_number > 0),
  position jsonb NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(position) = 'object'::text),
  text_content text NULL,

  -- Metadados
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT assessment_evidence_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,

  CONSTRAINT assessment_evidence_article_id_fkey
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,

  CONSTRAINT assessment_evidence_article_file_id_fkey
    FOREIGN KEY (article_file_id) REFERENCES article_files(id) ON DELETE SET NULL,

  CONSTRAINT assessment_evidence_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT
);

COMMENT ON TABLE assessment_evidence IS 'Evidências que suportam respostas de avaliação ou instances. Análogo a extraction_evidence.';
COMMENT ON COLUMN assessment_evidence.target_type IS 'Tipo do alvo: "response" (evidência para uma resposta específica) ou "instance" (evidência geral para a avaliação)';
COMMENT ON COLUMN assessment_evidence.target_id IS 'ID de assessment_responses (se target_type = response) ou assessment_instances (se target_type = instance)';
COMMENT ON COLUMN assessment_evidence.position IS 'Posição no documento (página, coordenadas) em formato JSONB';
COMMENT ON COLUMN assessment_evidence.text_content IS 'Trecho de texto citado como evidência';

-- =================== ÍNDICES ===================

-- assessment_instances
CREATE INDEX idx_assessment_instances_project
  ON assessment_instances(project_id);

CREATE INDEX idx_assessment_instances_article
  ON assessment_instances(article_id);

CREATE INDEX idx_assessment_instances_instrument
  ON assessment_instances(instrument_id);

CREATE INDEX idx_assessment_instances_extraction
  ON assessment_instances(extraction_instance_id)
  WHERE extraction_instance_id IS NOT NULL;

CREATE INDEX idx_assessment_instances_reviewer
  ON assessment_instances(reviewer_id);

CREATE INDEX idx_assessment_instances_parent
  ON assessment_instances(parent_instance_id)
  WHERE parent_instance_id IS NOT NULL;

CREATE INDEX idx_assessment_instances_status
  ON assessment_instances(status);

-- assessment_responses
CREATE INDEX idx_assessment_responses_project
  ON assessment_responses(project_id);

CREATE INDEX idx_assessment_responses_article
  ON assessment_responses(article_id);

CREATE INDEX idx_assessment_responses_instance
  ON assessment_responses(assessment_instance_id);

CREATE INDEX idx_assessment_responses_item
  ON assessment_responses(assessment_item_id);

CREATE INDEX idx_assessment_responses_reviewer
  ON assessment_responses(reviewer_id);

CREATE INDEX idx_assessment_responses_source
  ON assessment_responses(source);

CREATE INDEX idx_assessment_responses_level
  ON assessment_responses(selected_level);

-- assessment_evidence
CREATE INDEX idx_assessment_evidence_project
  ON assessment_evidence(project_id);

CREATE INDEX idx_assessment_evidence_article
  ON assessment_evidence(article_id);

CREATE INDEX idx_assessment_evidence_target
  ON assessment_evidence(target_type, target_id);

COMMENT ON INDEX idx_assessment_instances_extraction IS 'Índice parcial para queries de PROBAST por modelo (quando vinculado a extraction_instance)';
COMMENT ON INDEX idx_assessment_instances_parent IS 'Índice parcial para queries de hierarquia (child instances)';
COMMENT ON INDEX idx_assessment_responses_level IS 'Índice para queries de respostas por nível (ex: buscar todos "High risk")';

-- =================== RLS POLICIES ===================

-- assessment_instances
ALTER TABLE assessment_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view assessment instances"
  ON assessment_instances FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Members can manage assessment instances"
  ON assessment_instances FOR ALL
  USING (is_project_member(project_id, auth.uid()));

-- assessment_responses
ALTER TABLE assessment_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view assessment responses"
  ON assessment_responses FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Members can manage assessment responses"
  ON assessment_responses FOR ALL
  USING (is_project_member(project_id, auth.uid()));

-- assessment_evidence
ALTER TABLE assessment_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view assessment evidence"
  ON assessment_evidence FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Members can manage assessment evidence"
  ON assessment_evidence FOR ALL
  USING (is_project_member(project_id, auth.uid()));

-- =================== TRIGGERS ===================

-- Trigger para updated_at (assessment_instances)
CREATE TRIGGER trg_assessment_instances_updated_at
  BEFORE UPDATE ON assessment_instances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger para updated_at (assessment_responses)
CREATE TRIGGER trg_assessment_responses_updated_at
  BEFORE UPDATE ON assessment_responses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TRIGGER trg_assessment_instances_updated_at ON assessment_instances IS
'Atualiza automaticamente updated_at quando assessment_instance é modificada';

COMMENT ON TRIGGER trg_assessment_responses_updated_at ON assessment_responses IS
'Atualiza automaticamente updated_at quando assessment_response é modificada';

-- =================== VALIDAÇÃO DE HIERARQUIA ===================

-- Função para validar hierarquia de assessment_instances
-- Similar a validate_extraction_instance_hierarchy() mas adaptada para assessments
CREATE OR REPLACE FUNCTION validate_assessment_instance_hierarchy()
RETURNS TRIGGER AS $$
DECLARE
  v_parent_instance assessment_instances%ROWTYPE;
  v_child_instrument assessment_instruments%ROWTYPE;
BEGIN
  -- Se não tem parent, apenas validar extraction_instance constraint (já feito no CHECK)
  IF NEW.parent_instance_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- ========== VALIDAÇÕES COM PARENT ==========

  -- 1. Buscar parent instance
  SELECT * INTO v_parent_instance
  FROM assessment_instances
  WHERE id = NEW.parent_instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent instance % não encontrado', NEW.parent_instance_id;
  END IF;

  -- 2. Validar que parent e child estão no mesmo projeto
  IF v_parent_instance.project_id != NEW.project_id THEN
    RAISE EXCEPTION
      'Parent instance e child instance devem usar o mesmo project_id. Parent: %, Child: %',
      v_parent_instance.project_id,
      NEW.project_id;
  END IF;

  -- 3. Validar que parent e child estão no mesmo artigo
  IF v_parent_instance.article_id != NEW.article_id THEN
    RAISE EXCEPTION
      'Parent instance e child instance devem pertencer ao mesmo artigo. Parent: %, Child: %',
      v_parent_instance.article_id,
      NEW.article_id;
  END IF;

  -- 4. Validar que parent e child usam o mesmo instrumento
  IF v_parent_instance.instrument_id != NEW.instrument_id THEN
    RAISE EXCEPTION
      'Parent instance e child instance devem usar o mesmo instrument_id. Parent: %, Child: %',
      v_parent_instance.instrument_id,
      NEW.instrument_id;
  END IF;

  -- 5. Validar que parent e child têm mesmo extraction_instance_id (se aplicável)
  IF v_parent_instance.extraction_instance_id IS DISTINCT FROM NEW.extraction_instance_id THEN
    RAISE EXCEPTION
      'Child instance deve ter mesmo extraction_instance_id do parent. Parent: %, Child: %',
      v_parent_instance.extraction_instance_id,
      NEW.extraction_instance_id;
  END IF;

  -- 6. Validar ausência de ciclos (usando CTE recursiva limitada)
  IF EXISTS (
    WITH RECURSIVE hierarchy AS (
      SELECT id, parent_instance_id, 1 as depth
      FROM assessment_instances
      WHERE id = NEW.parent_instance_id

      UNION ALL

      SELECT ai.id, ai.parent_instance_id, h.depth + 1
      FROM assessment_instances ai
      JOIN hierarchy h ON ai.id = h.parent_instance_id
      WHERE h.depth < 10 -- Limite de profundidade para evitar loops infinitos
        AND ai.id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
    SELECT 1 FROM hierarchy
    WHERE parent_instance_id = NEW.id
    LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'Ciclo detectado na hierarquia: instância % seria filha de seu próprio descendente. Verifique a cadeia de parent_instance_id.',
      NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_assessment_instance_hierarchy() IS
'Valida integridade hierárquica de assessment_instances: consistência de projeto, artigo, instrumento, extraction_instance e ausência de ciclos. Similar a validate_extraction_instance_hierarchy().';

-- Trigger de validação
CREATE TRIGGER trg_validate_assessment_hierarchy
  BEFORE INSERT OR UPDATE OF parent_instance_id, project_id, article_id, instrument_id, extraction_instance_id
  ON assessment_instances
  FOR EACH ROW
  EXECUTE FUNCTION validate_assessment_instance_hierarchy();

COMMENT ON TRIGGER trg_validate_assessment_hierarchy ON assessment_instances IS
'Valida hierarquia antes de inserir/atualizar instances. Valida: projeto, artigo, instrumento, extraction_instance consistency e ciclos.';

-- =================== HELPER FUNCTIONS ===================

-- Função para buscar children de uma instance (útil para frontend)
CREATE OR REPLACE FUNCTION get_assessment_instance_children(p_instance_id UUID)
RETURNS TABLE (
  id UUID,
  label VARCHAR,
  status assessment_status,
  reviewer_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ai.id,
    ai.label,
    ai.status,
    ai.reviewer_id,
    ai.created_at,
    ai.updated_at
  FROM assessment_instances ai
  WHERE ai.parent_instance_id = p_instance_id
  ORDER BY ai.created_at;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_assessment_instance_children(UUID) IS
'Retorna child instances de uma assessment_instance. Útil para queries hierárquicas no frontend.';

-- Função para calcular progresso de uma assessment instance
CREATE OR REPLACE FUNCTION calculate_assessment_instance_progress(p_instance_id UUID)
RETURNS TABLE (
  total_items INTEGER,
  answered_items INTEGER,
  completion_percentage NUMERIC(5,2)
) AS $$
BEGIN
  RETURN QUERY
  WITH instance_info AS (
    SELECT instrument_id
    FROM assessment_instances
    WHERE id = p_instance_id
  ),
  total AS (
    SELECT COUNT(*) as total_count
    FROM assessment_items ai
    WHERE ai.instrument_id = (SELECT instrument_id FROM instance_info)
      AND ai.required = true
  ),
  answered AS (
    SELECT COUNT(DISTINCT ar.assessment_item_id) as answered_count
    FROM assessment_responses ar
    WHERE ar.assessment_instance_id = p_instance_id
  )
  SELECT
    total.total_count::INTEGER as total_items,
    answered.answered_count::INTEGER as answered_items,
    CASE
      WHEN total.total_count = 0 THEN 0::NUMERIC(5,2)
      ELSE ROUND((answered.answered_count::NUMERIC / total.total_count::NUMERIC) * 100, 2)
    END as completion_percentage
  FROM total, answered;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_assessment_instance_progress(UUID) IS
'Calcula progresso de uma assessment instance (itens respondidos / total de itens obrigatórios).';

-- =================== FIM DA MIGRATION ===================
