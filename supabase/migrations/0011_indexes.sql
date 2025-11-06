-- =====================================================
-- MIGRATION: Indexes
-- =====================================================
-- Descrição: Cria todos os índices necessários para performance
-- =====================================================

-- =================== PROFILES ===================
-- Profiles não precisa de índices adicionais além da PK

-- =================== PROJECTS ===================
CREATE INDEX idx_projects_active ON projects(is_active);
CREATE INDEX idx_projects_created_by ON projects(created_by_id);
CREATE INDEX idx_projects_review_type ON projects(review_type);

-- =================== PROJECT MEMBERS ===================
CREATE INDEX idx_project_members_project ON project_members(project_id);
CREATE INDEX idx_project_members_user ON project_members(user_id);
CREATE INDEX idx_project_members_role ON project_members(role);

-- =================== ARTICLES ===================
CREATE INDEX idx_articles_project ON articles(project_id);
CREATE INDEX idx_articles_biblio ON articles(publication_year, journal_title);
CREATE INDEX idx_articles_idents ON articles(doi, pmid, pmcid);
CREATE INDEX idx_articles_trgm_title ON articles USING gin (title gin_trgm_ops);
CREATE INDEX idx_articles_keywords ON articles USING gin (keywords);
CREATE INDEX idx_articles_mesh ON articles USING gin (mesh_terms);
CREATE INDEX idx_articles_zotero_item_key ON articles(zotero_item_key) WHERE zotero_item_key IS NOT NULL;
CREATE INDEX idx_articles_zotero_collection ON articles(zotero_collection_key) WHERE zotero_collection_key IS NOT NULL;
CREATE UNIQUE INDEX uq_articles_project_zotero_item ON articles(project_id, zotero_item_key) WHERE zotero_item_key IS NOT NULL;

-- =================== ARTICLE FILES ===================
CREATE INDEX idx_article_files_project ON article_files(project_id);
CREATE INDEX idx_article_files_article ON article_files(article_id);
CREATE INDEX idx_article_files_file_role ON article_files(file_role);

-- =================== ARTICLE HIGHLIGHTS ===================
CREATE INDEX idx_highlights_article ON article_highlights(article_id);
CREATE INDEX idx_highlights_page ON article_highlights(article_id, page_number);
CREATE INDEX idx_highlights_author ON article_highlights(author_id);

-- =================== ARTICLE BOXES ===================
CREATE INDEX idx_boxes_article ON article_boxes(article_id);
CREATE INDEX idx_boxes_page ON article_boxes(article_id, page_number);
CREATE INDEX idx_boxes_author ON article_boxes(author_id);

-- =================== ARTICLE ANNOTATIONS ===================
CREATE INDEX idx_annotations_article ON article_annotations(article_id);
CREATE INDEX idx_annotations_highlight ON article_annotations(highlight_id) WHERE highlight_id IS NOT NULL;
CREATE INDEX idx_annotations_box ON article_annotations(box_id) WHERE box_id IS NOT NULL;
CREATE INDEX idx_annotations_parent ON article_annotations(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_annotations_author ON article_annotations(author_id);

-- =================== EXTRACTION TEMPLATES GLOBAL ===================
CREATE INDEX idx_extraction_templates_global_framework ON extraction_templates_global(framework);
CREATE INDEX idx_extraction_templates_global_schema_gin ON extraction_templates_global USING GIN (schema);

-- =================== PROJECT EXTRACTION TEMPLATES ===================
CREATE INDEX idx_project_extraction_templates_project ON project_extraction_templates(project_id);
CREATE INDEX idx_project_extraction_templates_active ON project_extraction_templates(project_id, is_active);
CREATE INDEX idx_project_extraction_templates_global ON project_extraction_templates(global_template_id) WHERE global_template_id IS NOT NULL;
CREATE INDEX idx_project_extraction_templates_schema_gin ON project_extraction_templates USING GIN (schema);

-- =================== EXTRACTION ENTITY TYPES ===================
CREATE INDEX idx_extraction_entity_types_template ON extraction_entity_types(template_id) WHERE template_id IS NOT NULL;
CREATE INDEX idx_extraction_entity_types_project_template ON extraction_entity_types(project_template_id) WHERE project_template_id IS NOT NULL;
CREATE INDEX idx_extraction_entity_types_parent ON extraction_entity_types(parent_entity_type_id) WHERE parent_entity_type_id IS NOT NULL;
CREATE INDEX idx_extraction_entity_types_sort ON extraction_entity_types(template_id, sort_order) WHERE template_id IS NOT NULL;
CREATE INDEX idx_extraction_entity_types_project_sort ON extraction_entity_types(project_template_id, sort_order) WHERE project_template_id IS NOT NULL;

-- =================== EXTRACTION FIELDS ===================
CREATE INDEX idx_extraction_fields_entity ON extraction_fields(entity_type_id);
CREATE INDEX idx_extraction_fields_sort ON extraction_fields(entity_type_id, sort_order);

-- =================== EXTRACTION INSTANCES ===================
CREATE INDEX idx_extraction_instances_project ON extraction_instances(project_id);
CREATE INDEX idx_extraction_instances_article ON extraction_instances(article_id) WHERE article_id IS NOT NULL;
CREATE INDEX idx_extraction_instances_template ON extraction_instances(template_id);
CREATE INDEX idx_extraction_instances_entity ON extraction_instances(entity_type_id);
CREATE INDEX idx_extraction_instances_parent ON extraction_instances(parent_instance_id) WHERE parent_instance_id IS NOT NULL;
CREATE INDEX idx_extraction_instances_sort ON extraction_instances(article_id, entity_type_id, sort_order) WHERE article_id IS NOT NULL;
CREATE INDEX idx_extraction_instances_metadata_gin ON extraction_instances USING GIN (metadata);
CREATE INDEX idx_extraction_instances_status ON extraction_instances(status);

-- =================== EXTRACTED VALUES ===================
CREATE INDEX idx_extracted_values_project ON extracted_values(project_id);
CREATE INDEX idx_extracted_values_article ON extracted_values(article_id);
CREATE INDEX idx_extracted_values_instance ON extracted_values(instance_id);
CREATE INDEX idx_extracted_values_field ON extracted_values(field_id);
CREATE INDEX idx_extracted_values_reviewer ON extracted_values(reviewer_id) WHERE reviewer_id IS NOT NULL;
CREATE INDEX idx_extracted_values_consensus ON extracted_values(instance_id, field_id, is_consensus);
CREATE INDEX idx_extracted_values_ai_suggestion ON extracted_values(ai_suggestion_id) WHERE ai_suggestion_id IS NOT NULL;
CREATE INDEX idx_extracted_values_value_gin ON extracted_values USING GIN (value);
CREATE INDEX idx_extracted_values_evidence_gin ON extracted_values USING GIN (evidence);

-- =================== EXTRACTION EVIDENCE ===================
CREATE INDEX idx_extraction_evidence_project ON extraction_evidence(project_id);
CREATE INDEX idx_extraction_evidence_article ON extraction_evidence(article_id);
CREATE INDEX idx_extraction_evidence_target ON extraction_evidence(target_type, target_id);
CREATE INDEX idx_extraction_evidence_file ON extraction_evidence(article_file_id) WHERE article_file_id IS NOT NULL;
CREATE INDEX idx_extraction_evidence_created_by ON extraction_evidence(created_by);
CREATE INDEX idx_extraction_evidence_position_gin ON extraction_evidence USING GIN (position);

-- =================== EXTRACTION RUNS ===================
CREATE INDEX idx_extraction_runs_project ON extraction_runs(project_id);
CREATE INDEX idx_extraction_runs_article ON extraction_runs(article_id);
CREATE INDEX idx_extraction_runs_template ON extraction_runs(template_id);
CREATE INDEX idx_extraction_runs_status ON extraction_runs(status, stage);
CREATE INDEX idx_extraction_runs_created_by ON extraction_runs(created_by);
CREATE INDEX idx_extraction_runs_parameters_gin ON extraction_runs USING GIN (parameters);
CREATE INDEX idx_extraction_runs_results_gin ON extraction_runs USING GIN (results);

-- =================== AI SUGGESTIONS ===================
CREATE INDEX idx_ai_suggestions_run ON ai_suggestions(run_id);
CREATE INDEX idx_ai_suggestions_instance ON ai_suggestions(instance_id) WHERE instance_id IS NOT NULL;
CREATE INDEX idx_ai_suggestions_field ON ai_suggestions(field_id);
CREATE INDEX idx_ai_suggestions_status ON ai_suggestions(status);
CREATE INDEX idx_ai_suggestions_reviewed_by ON ai_suggestions(reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX idx_ai_suggestions_suggested_value_gin ON ai_suggestions USING GIN (suggested_value);
CREATE INDEX idx_ai_suggestions_metadata_gin ON ai_suggestions USING GIN (metadata);

-- =================== ASSESSMENT INSTRUMENTS ===================
CREATE INDEX idx_assessment_instruments_tool_type ON assessment_instruments(tool_type);
CREATE INDEX idx_assessment_instruments_active ON assessment_instruments(is_active);

-- =================== ASSESSMENT ITEMS ===================
CREATE INDEX idx_assessment_items_instrument ON assessment_items(instrument_id);
CREATE INDEX idx_assessment_items_domain ON assessment_items(domain);
CREATE INDEX idx_assessment_items_sort ON assessment_items(instrument_id, sort_order);

-- =================== ASSESSMENTS ===================
CREATE INDEX idx_assessments_article ON assessments(article_id);
CREATE INDEX idx_assessments_user ON assessments(user_id);
CREATE INDEX idx_assessments_project ON assessments(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_assessments_instrument ON assessments(instrument_id) WHERE instrument_id IS NOT NULL;
CREATE INDEX idx_assessments_status ON assessments(status);
CREATE INDEX idx_assessments_parent ON assessments(parent_assessment_id) WHERE parent_assessment_id IS NOT NULL;
CREATE INDEX idx_assessments_extraction_instance ON assessments(extraction_instance_id) WHERE extraction_instance_id IS NOT NULL;
CREATE INDEX idx_assessments_responses_gin ON assessments USING GIN (responses);
CREATE INDEX idx_assessments_comments_gin ON assessments USING GIN (comments);

-- =================== AI ASSESSMENT CONFIGS ===================
CREATE INDEX idx_ai_assessment_configs_project ON ai_assessment_configs(project_id);
CREATE INDEX idx_ai_assessment_configs_instrument ON ai_assessment_configs(instrument_id) WHERE instrument_id IS NOT NULL;
CREATE INDEX idx_ai_assessment_configs_active ON ai_assessment_configs(project_id, is_active);

-- =================== AI ASSESSMENT PROMPTS ===================
CREATE INDEX idx_ai_assessment_prompts_item ON ai_assessment_prompts(assessment_item_id);

-- =================== AI ASSESSMENTS ===================
CREATE INDEX idx_ai_assessments_project ON ai_assessments(project_id);
CREATE INDEX idx_ai_assessments_article ON ai_assessments(article_id);
CREATE INDEX idx_ai_assessments_item ON ai_assessments(assessment_item_id);
CREATE INDEX idx_ai_assessments_instrument ON ai_assessments(instrument_id);
CREATE INDEX idx_ai_assessments_user ON ai_assessments(user_id);
CREATE INDEX idx_ai_assessments_status ON ai_assessments(status);
CREATE INDEX idx_ai_assessments_evidence_gin ON ai_assessments USING GIN (evidence_passages);

-- =================== ZOTERO INTEGRATIONS ===================
CREATE INDEX idx_zotero_integrations_user ON zotero_integrations(user_id);
CREATE INDEX idx_zotero_integrations_active ON zotero_integrations(is_active) WHERE is_active = true;

-- =================== FEEDBACK REPORTS ===================
CREATE INDEX idx_feedback_user ON feedback_reports(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_feedback_status ON feedback_reports(status);
CREATE INDEX idx_feedback_type ON feedback_reports(type);
CREATE INDEX idx_feedback_created ON feedback_reports(created_at DESC);
CREATE INDEX idx_feedback_priority ON feedback_reports(priority DESC, created_at DESC);
CREATE INDEX idx_feedback_project ON feedback_reports(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_feedback_article ON feedback_reports(article_id) WHERE article_id IS NOT NULL;

