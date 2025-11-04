-- Adicionar coluna file_role na tabela article_files
-- Esta coluna define a função/papel do arquivo no artigo (MAIN, SUPPLEMENT, etc.)

-- Adicionar a coluna file_role (nullable por padrão para arquivos existentes)
ALTER TABLE article_files 
ADD COLUMN IF NOT EXISTS file_role VARCHAR(20);

-- Definir valor padrão para arquivos existentes (MAIN = arquivo principal)
UPDATE article_files 
SET file_role = 'MAIN' 
WHERE file_role IS NULL;

-- Adicionar constraint para garantir valores válidos
ALTER TABLE article_files
ADD CONSTRAINT check_file_role 
CHECK (
  file_role IS NULL OR 
  file_role IN ('MAIN', 'SUPPLEMENT', 'PROTOCOL', 'DATASET', 'APPENDIX', 'FIGURE', 'OTHER')
);

-- Comentário na coluna para documentação
COMMENT ON COLUMN article_files.file_role IS 
  'Função/papel do arquivo no artigo: MAIN (principal), SUPPLEMENT (suplementar), PROTOCOL, DATASET, APPENDIX, FIGURE, OTHER';

