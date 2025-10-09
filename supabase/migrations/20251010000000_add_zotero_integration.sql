-- =================== INTEGRAÇÃO ZOTERO ===================
-- Suporte completo para importação de artigos do Zotero
-- 
-- Arquitetura:
-- - Credenciais criptografadas com AES-GCM via Web Crypto API (Edge Function)
-- - Chave única por usuário derivada com PBKDF2
-- - API key nunca exposta ao frontend
-- - RLS garante isolamento entre usuários
--
-- Dependências: pgcrypto (já habilitado)

-- 1. Tabela para integração Zotero por usuário
CREATE TABLE IF NOT EXISTS zotero_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  zotero_user_id text NOT NULL,
  encrypted_api_key text, -- API key criptografada (base64)
  library_type text NOT NULL CHECK (library_type IN ('user', 'group')),
  is_active boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_zotero_user_integration UNIQUE (user_id)
);

-- Índices
CREATE INDEX idx_zotero_integrations_user ON zotero_integrations(user_id);
CREATE INDEX idx_zotero_integrations_active ON zotero_integrations(is_active) WHERE is_active = true;

-- Trigger
CREATE TRIGGER trg_zotero_integrations_updated_at
  BEFORE UPDATE ON zotero_integrations 
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
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

-- 2. Adicionar colunas de tracking na tabela articles
ALTER TABLE articles 
  ADD COLUMN IF NOT EXISTS zotero_item_key text,
  ADD COLUMN IF NOT EXISTS zotero_collection_key text,
  ADD COLUMN IF NOT EXISTS zotero_version int;

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_articles_zotero_item_key 
  ON articles(zotero_item_key) 
  WHERE zotero_item_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_articles_zotero_collection 
  ON articles(zotero_collection_key) 
  WHERE zotero_collection_key IS NOT NULL;

-- Unicidade: mesmo item Zotero não pode ser importado 2x no mesmo projeto
CREATE UNIQUE INDEX IF NOT EXISTS uq_articles_project_zotero_item 
  ON articles(project_id, zotero_item_key) 
  WHERE zotero_item_key IS NOT NULL;

-- 3. Comentários para documentação
COMMENT ON TABLE zotero_integrations IS 
  'Integrações Zotero por usuário. API keys criptografadas com AES-GCM pela Edge Function.';

COMMENT ON COLUMN zotero_integrations.encrypted_api_key IS 
  'API key criptografada com AES-GCM (base64). Criptografia feita pela Edge Function usando Web Crypto API.';

COMMENT ON COLUMN zotero_integrations.user_id IS 
  'User ID usado como parte da chave de derivação para criptografia única por usuário.';

COMMENT ON COLUMN articles.zotero_item_key IS 
  'Chave única do item no Zotero para tracking e detecção de duplicatas';

COMMENT ON COLUMN articles.zotero_collection_key IS 
  'Collection de origem no Zotero (para referência)';

COMMENT ON COLUMN articles.zotero_version IS 
  'Versão do item no Zotero. Usado para detectar se metadados foram atualizados.';
