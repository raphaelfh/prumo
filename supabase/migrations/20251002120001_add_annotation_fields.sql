-- Adicionar campo para texto selecionado (para highlights)
ALTER TABLE public.article_annotations 
ADD COLUMN IF NOT EXISTS selected_text TEXT;

-- Criar índice para melhor performance em consultas por tipo
CREATE INDEX IF NOT EXISTS idx_ann_type ON public.article_annotations(type);

-- Criar índice para consultas por autor e status
CREATE INDEX IF NOT EXISTS idx_ann_author_status ON public.article_annotations(author_id, status);

-- Comentário sobre estrutura do campo color
COMMENT ON COLUMN public.article_annotations.color IS 
'Formato: {"color": "hsl(var(--primary))", "opacity": 0.3} ou {"r":255,"g":255,"b":0,"opacity":0.25}';
