-- =====================================================
-- MIGRATION: Row Level Security Policies
-- =====================================================
-- Descrição: Habilita RLS e cria políticas de segurança
-- para todas as tabelas
-- =====================================================

-- =================== PROFILES ===================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- =================== PROJECTS ===================
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view accessible projects"
  ON projects FOR SELECT
  USING (is_project_member(id, auth.uid()));

CREATE POLICY "Authenticated users can create projects"
  ON projects FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = created_by_id);

CREATE POLICY "Managers can update projects"
  ON projects FOR UPDATE
  USING (is_project_manager(id, auth.uid()));

-- =================== PROJECT MEMBERS ===================
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view project members"
  ON project_members FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id AND p.created_by_id = auth.uid()
    )
    OR is_project_member(project_id, auth.uid())
  );

CREATE POLICY "Project owner can manage members"
  ON project_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id AND p.created_by_id = auth.uid()
    )
    OR is_project_manager(project_id, auth.uid())
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id AND p.created_by_id = auth.uid()
    )
    OR is_project_manager(project_id, auth.uid())
  );

-- =================== ARTICLES ===================
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view project articles"
  ON articles FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Members can manage articles"
  ON articles FOR ALL
  USING (is_project_member(project_id, auth.uid()));

-- =================== ARTICLE FILES ===================
ALTER TABLE article_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view article files"
  ON article_files FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Members can manage article files"
  ON article_files FOR ALL
  USING (is_project_member(project_id, auth.uid()));

-- =================== ARTICLE HIGHLIGHTS ===================
ALTER TABLE article_highlights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view highlights"
  ON article_highlights FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM articles a
      WHERE a.id = article_highlights.article_id
      AND is_project_member(a.project_id, auth.uid())
    )
  );

CREATE POLICY "Members can create highlights"
  ON article_highlights FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM articles a
      WHERE a.id = article_highlights.article_id
      AND is_project_member(a.project_id, auth.uid())
    )
  );

CREATE POLICY "Users can update own highlights"
  ON article_highlights FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "Users can delete own highlights"
  ON article_highlights FOR DELETE
  TO authenticated
  USING (author_id = auth.uid());

-- =================== ARTICLE BOXES ===================
ALTER TABLE article_boxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view boxes"
  ON article_boxes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM articles a
      WHERE a.id = article_boxes.article_id
      AND is_project_member(a.project_id, auth.uid())
    )
  );

CREATE POLICY "Members can create boxes"
  ON article_boxes FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM articles a
      WHERE a.id = article_boxes.article_id
      AND is_project_member(a.project_id, auth.uid())
    )
  );

CREATE POLICY "Users can update own boxes"
  ON article_boxes FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "Users can delete own boxes"
  ON article_boxes FOR DELETE
  TO authenticated
  USING (author_id = auth.uid());

-- =================== ARTICLE ANNOTATIONS ===================
ALTER TABLE article_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view annotations"
  ON article_annotations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM articles a
      WHERE a.id = article_annotations.article_id
      AND is_project_member(a.project_id, auth.uid())
    )
  );

CREATE POLICY "Members can create annotations"
  ON article_annotations FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM articles a
      WHERE a.id = article_annotations.article_id
      AND is_project_member(a.project_id, auth.uid())
    )
  );

CREATE POLICY "Users can update own annotations"
  ON article_annotations FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "Users can delete own annotations"
  ON article_annotations FOR DELETE
  TO authenticated
  USING (author_id = auth.uid());

-- =================== EXTRACTION TEMPLATES GLOBAL ===================
ALTER TABLE extraction_templates_global ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view global templates"
  ON extraction_templates_global FOR SELECT
  USING (is_global = true);

-- =================== PROJECT EXTRACTION TEMPLATES ===================
ALTER TABLE project_extraction_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view project templates"
  ON project_extraction_templates FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Managers can manage project templates"
  ON project_extraction_templates FOR ALL
  USING (is_project_manager(project_id, auth.uid()));

-- =================== EXTRACTION ENTITY TYPES ===================
ALTER TABLE extraction_entity_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_view_entity_types"
  ON extraction_entity_types FOR SELECT
  USING (
    -- Entity types vinculados a templates globais (públicos)
    template_id IN (
      SELECT etg.id FROM extraction_templates_global etg WHERE etg.is_global = true
    )
    OR
    -- OU entity types vinculados a templates de projeto onde usuário é membro
    project_template_id IN (
      SELECT pet.id FROM project_extraction_templates pet
      WHERE project_id IN (
        SELECT project_id FROM project_members
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "managers_insert_entity_types"
  ON extraction_entity_types FOR INSERT
  WITH CHECK (
    -- Templates globais (qualquer um pode inserir se for admin)
    template_id IN (
      SELECT etg.id FROM extraction_templates_global etg WHERE etg.is_global = true
    )
    OR
    -- Templates de projeto onde usuário é manager
    project_template_id IN (
      SELECT pet.id FROM project_extraction_templates pet
      WHERE project_id IN (
        SELECT project_id FROM project_members
        WHERE user_id = auth.uid()
        AND role = 'manager'
      )
    )
  );

CREATE POLICY "managers_update_entity_types"
  ON extraction_entity_types FOR UPDATE
  USING (
    template_id IN (
      SELECT etg.id FROM extraction_templates_global etg WHERE etg.is_global = true
    )
    OR
    project_template_id IN (
      SELECT pet.id FROM project_extraction_templates pet
      WHERE project_id IN (
        SELECT project_id FROM project_members
        WHERE user_id = auth.uid()
        AND role = 'manager'
      )
    )
  );

CREATE POLICY "managers_delete_entity_types"
  ON extraction_entity_types FOR DELETE
  USING (
    template_id IN (
      SELECT etg.id FROM extraction_templates_global etg WHERE etg.is_global = true
    )
    OR
    project_template_id IN (
      SELECT pet.id FROM project_extraction_templates pet
      WHERE project_id IN (
        SELECT project_id FROM project_members
        WHERE user_id = auth.uid()
        AND role = 'manager'
      )
    )
  );

-- =================== EXTRACTION FIELDS ===================
ALTER TABLE extraction_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_view_extraction_fields"
  ON extraction_fields FOR SELECT
  USING (
    EXISTS (
      SELECT 1 
      FROM extraction_entity_types eet
      WHERE eet.id = extraction_fields.entity_type_id
        AND (
          -- Templates globais (públicos)
          eet.template_id IN (
            SELECT etg.id FROM extraction_templates_global etg WHERE etg.is_global = true
          )
          OR
          -- Templates de projeto onde é membro
          eet.project_template_id IN (
            SELECT pet.id FROM project_extraction_templates pet
            WHERE project_id IN (
              SELECT project_id FROM project_members
              WHERE user_id = auth.uid()
            )
          )
        )
    )
  );

CREATE POLICY "managers_insert_extraction_fields"
  ON extraction_fields FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM extraction_entity_types eet
      WHERE eet.id = extraction_fields.entity_type_id
        AND (
          -- Templates globais
          eet.template_id IN (
            SELECT etg.id FROM extraction_templates_global etg WHERE etg.is_global = true
          )
          OR
          -- Templates de projeto onde é manager
          eet.project_template_id IN (
            SELECT pet.id FROM project_extraction_templates pet
            JOIN project_members pm ON pm.project_id = pet.project_id
            WHERE pm.user_id = auth.uid()
              AND pm.role = 'manager'
          )
        )
    )
  );

CREATE POLICY "managers_update_extraction_fields"
  ON extraction_fields FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 
      FROM extraction_entity_types eet
      WHERE eet.id = extraction_fields.entity_type_id
        AND (
          -- Templates globais
          eet.template_id IN (
            SELECT etg.id FROM extraction_templates_global etg WHERE etg.is_global = true
          )
          OR
          -- Templates de projeto onde é manager
          eet.project_template_id IN (
            SELECT pet.id FROM project_extraction_templates pet
            JOIN project_members pm ON pm.project_id = pet.project_id
            WHERE pm.user_id = auth.uid()
              AND pm.role = 'manager'
          )
        )
    )
  );

CREATE POLICY "managers_delete_extraction_fields"
  ON extraction_fields FOR DELETE
  USING (
    EXISTS (
      SELECT 1 
      FROM extraction_entity_types eet
      WHERE eet.id = extraction_fields.entity_type_id
        AND (
          -- Templates globais
          eet.template_id IN (
            SELECT etg.id FROM extraction_templates_global etg WHERE etg.is_global = true
          )
          OR
          -- Templates de projeto onde é manager
          eet.project_template_id IN (
            SELECT pet.id FROM project_extraction_templates pet
            JOIN project_members pm ON pm.project_id = pet.project_id
            WHERE pm.user_id = auth.uid()
              AND pm.role = 'manager'
          )
        )
    )
  );

-- =================== EXTRACTION INSTANCES ===================
ALTER TABLE extraction_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view instances"
  ON extraction_instances FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Members can manage instances"
  ON extraction_instances FOR ALL
  USING (is_project_member(project_id, auth.uid()));

-- =================== EXTRACTED VALUES ===================
ALTER TABLE extracted_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view extracted values"
  ON extracted_values FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Members can manage extracted values"
  ON extracted_values FOR ALL
  USING (is_project_member(project_id, auth.uid()));

-- =================== EXTRACTION EVIDENCE ===================
ALTER TABLE extraction_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view evidence"
  ON extraction_evidence FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Members can manage evidence"
  ON extraction_evidence FOR ALL
  USING (is_project_member(project_id, auth.uid()));

-- =================== EXTRACTION RUNS ===================
ALTER TABLE extraction_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view extraction runs"
  ON extraction_runs FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Members can manage extraction runs"
  ON extraction_runs FOR ALL
  USING (is_project_member(project_id, auth.uid()));

-- =================== AI SUGGESTIONS ===================
ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view ai suggestions"
  ON ai_suggestions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM extraction_runs er 
      WHERE er.id = ai_suggestions.run_id 
      AND is_project_member(er.project_id, auth.uid())
    )
  );

CREATE POLICY "Members can manage ai suggestions"
  ON ai_suggestions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM extraction_runs er 
      WHERE er.id = ai_suggestions.run_id 
      AND is_project_member(er.project_id, auth.uid())
    )
  );

-- =================== ASSESSMENT INSTRUMENTS ===================
ALTER TABLE assessment_instruments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view instruments"
  ON assessment_instruments FOR SELECT
  USING (true);

-- =================== ASSESSMENT ITEMS ===================
ALTER TABLE assessment_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view assessment items"
  ON assessment_items FOR SELECT
  USING (true);

-- =================== ASSESSMENTS ===================
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view assessments"
  ON assessments FOR SELECT
  USING (
    project_id IS NULL OR is_project_member(project_id, auth.uid())
  );

CREATE POLICY "Members can manage assessments"
  ON assessments FOR ALL
  USING (
    (project_id IS NULL OR is_project_member(project_id, auth.uid()))
    AND (user_id = auth.uid() OR is_project_manager(project_id, auth.uid()))
  );

-- =================== AI ASSESSMENT CONFIGS ===================
ALTER TABLE ai_assessment_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view ai assessment configs"
  ON ai_assessment_configs FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Managers can manage ai assessment configs"
  ON ai_assessment_configs FOR ALL
  USING (is_project_manager(project_id, auth.uid()));

-- =================== AI ASSESSMENT PROMPTS ===================
ALTER TABLE ai_assessment_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view ai assessment prompts"
  ON ai_assessment_prompts FOR SELECT
  USING (true);

-- =================== AI ASSESSMENTS ===================
ALTER TABLE ai_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view ai assessments"
  ON ai_assessments FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "Members can manage ai assessments"
  ON ai_assessments FOR ALL
  USING (is_project_member(project_id, auth.uid()));

-- =================== ZOTERO INTEGRATIONS ===================
ALTER TABLE zotero_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own Zotero integration"
  ON zotero_integrations FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own Zotero integration"
  ON zotero_integrations FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own Zotero integration"
  ON zotero_integrations FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own Zotero integration"
  ON zotero_integrations FOR DELETE 
  USING (auth.uid() = user_id);

-- =================== FEEDBACK REPORTS ===================
ALTER TABLE feedback_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can create feedback"
  ON feedback_reports FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can view own feedback"
  ON feedback_reports FOR SELECT
  USING (
    auth.uid() = user_id 
    OR user_id IS NULL
  );

