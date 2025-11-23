-- =====================================================
-- MIGRATION: Annotations Tables
-- =====================================================
-- Descrição: Cria tabelas para anotações em artigos: highlights, 
-- boxes e annotations
-- =====================================================

-- =================== ARTICLE HIGHLIGHTS ===================

CREATE TABLE article_highlights (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL,
  page_number integer NOT NULL,
  selected_text text NOT NULL,
  scaled_position jsonb NOT NULL,
  color jsonb NOT NULL DEFAULT '{"b": 59, "g": 235, "r": 255, "opacity": 0.4}'::jsonb,
  author_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  article_file_id uuid,
  dom_target jsonb,
  CONSTRAINT article_highlights_article_id_fkey FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  CONSTRAINT article_highlights_author_id_fkey FOREIGN KEY (author_id) REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT article_highlights_article_file_id_fkey FOREIGN KEY (article_file_id) REFERENCES article_files(id) ON DELETE SET NULL
);

COMMENT ON TABLE article_highlights IS 'Destaques/seleções de texto feitos pelos usuários em artigos';
COMMENT ON COLUMN article_highlights.scaled_position IS 'Posição escalada do highlight no documento (JSON)';
COMMENT ON COLUMN article_highlights.dom_target IS 'Referência DOM para o elemento destacado';

-- =================== ARTICLE BOXES ===================

CREATE TABLE article_boxes (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL,
  page_number integer NOT NULL,
  scaled_position jsonb NOT NULL,
  color jsonb NOT NULL DEFAULT '{"b": 59, "g": 235, "r": 255, "opacity": 0.4}'::jsonb,
  author_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  article_file_id uuid,
  CONSTRAINT article_boxes_article_id_fkey FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  CONSTRAINT article_boxes_author_id_fkey FOREIGN KEY (author_id) REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT article_boxes_article_file_id_fkey FOREIGN KEY (article_file_id) REFERENCES article_files(id) ON DELETE SET NULL
);

COMMENT ON TABLE article_boxes IS 'Caixas/áreas desenhadas pelos usuários em artigos';
COMMENT ON COLUMN article_boxes.scaled_position IS 'Posição escalada da caixa no documento (JSON)';

-- =================== ARTICLE ANNOTATIONS ===================

CREATE TABLE article_annotations (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL,
  highlight_id uuid,
  box_id uuid,
  parent_id uuid,
  content text NOT NULL,
  author_id uuid,
  is_resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT article_annotations_article_id_fkey FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  CONSTRAINT article_annotations_highlight_id_fkey FOREIGN KEY (highlight_id) REFERENCES article_highlights(id) ON DELETE CASCADE,
  CONSTRAINT article_annotations_box_id_fkey FOREIGN KEY (box_id) REFERENCES article_boxes(id) ON DELETE CASCADE,
  CONSTRAINT article_annotations_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES article_annotations(id) ON DELETE CASCADE,
  CONSTRAINT article_annotations_author_id_fkey FOREIGN KEY (author_id) REFERENCES profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE article_annotations IS 'Anotações/comentários associados a highlights, boxes ou outras anotações';
COMMENT ON COLUMN article_annotations.parent_id IS 'Referência para anotação pai (threading)';
COMMENT ON COLUMN article_annotations.is_resolved IS 'Indica se a anotação foi resolvida';

