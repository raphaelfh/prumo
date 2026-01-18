-- =====================================================
-- MIGRATION: User API Keys
-- =====================================================
-- Descrição: Cria tabela para armazenar API keys de provedores
-- externos (OpenAI, Anthropic, Gemini, Grok).
-- 
-- NOTA: A criptografia é feita no nível da aplicação usando Fernet,
-- seguindo o mesmo padrão de zotero_integrations.
-- Isso garante funcionamento tanto em ambiente local quanto em produção.
-- =====================================================

-- =================== USER API KEYS TABLE ===================

CREATE TABLE user_api_keys (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  
  -- Provedor da API key
  provider text NOT NULL CHECK (provider IN ('openai', 'anthropic', 'gemini', 'grok')),
  
  -- API key criptografada via Fernet na aplicação (igual ao Zotero)
  encrypted_api_key text NOT NULL,
  
  -- Nome opcional para identificar a key
  key_name text,
  
  -- Status
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  
  -- Tracking de uso e validação
  last_used_at timestamptz,
  last_validated_at timestamptz,
  validation_status text CHECK (validation_status IS NULL OR validation_status IN ('valid', 'invalid', 'pending')),
  
  -- Metadados extras (modelo preferido, região, etc.)
  metadata jsonb DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- FK para profiles
  CONSTRAINT user_api_keys_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- =================== INDEXES ===================

-- Índice para busca por usuário e provedor
CREATE INDEX idx_user_api_keys_user_provider 
  ON user_api_keys(user_id, provider) 
  WHERE is_active = true;

-- Índice para busca de key default por usuário
CREATE INDEX idx_user_api_keys_user_default 
  ON user_api_keys(user_id, provider, is_default) 
  WHERE is_active = true AND is_default = true;

-- =================== TRIGGER UPDATED_AT ===================

CREATE TRIGGER set_user_api_keys_updated_at
  BEFORE UPDATE ON user_api_keys
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- =================== RLS POLICIES ===================

ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

-- Usuários só podem ver suas próprias keys
CREATE POLICY "Users can view own API keys"
  ON user_api_keys FOR SELECT
  USING (auth.uid() = user_id);

-- Usuários só podem inserir suas próprias keys
CREATE POLICY "Users can insert own API keys"
  ON user_api_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Usuários só podem atualizar suas próprias keys
CREATE POLICY "Users can update own API keys"
  ON user_api_keys FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Usuários só podem deletar suas próprias keys
CREATE POLICY "Users can delete own API keys"
  ON user_api_keys FOR DELETE
  USING (auth.uid() = user_id);

-- =================== COMMENTS ===================

COMMENT ON TABLE user_api_keys IS 
  'API keys de provedores externos por usuário. Criptografadas com Fernet na aplicação.';

COMMENT ON COLUMN user_api_keys.encrypted_api_key IS 
  'API key criptografada via Fernet (base64). Mesmo padrão de zotero_integrations.';

COMMENT ON COLUMN user_api_keys.provider IS 
  'Provedor da API: openai, anthropic, gemini, grok';

COMMENT ON COLUMN user_api_keys.is_default IS 
  'Se esta é a key padrão para o provedor. Apenas uma key default por provedor por usuário.';

COMMENT ON COLUMN user_api_keys.validation_status IS 
  'Status da última validação: valid, invalid, pending';

-- =================== HELPER FUNCTION ===================
-- Função para garantir apenas uma key default por provedor por usuário

CREATE OR REPLACE FUNCTION ensure_single_default_api_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Se a nova key está sendo marcada como default
  IF NEW.is_default = true THEN
    -- Desmarcar outras keys do mesmo provedor como não-default
    UPDATE user_api_keys
    SET is_default = false, updated_at = now()
    WHERE user_id = NEW.user_id
      AND provider = NEW.provider
      AND id != NEW.id
      AND is_default = true;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER ensure_single_default_api_key_trigger
  BEFORE INSERT OR UPDATE OF is_default ON user_api_keys
  FOR EACH ROW
  WHEN (NEW.is_default = true)
  EXECUTE FUNCTION ensure_single_default_api_key();

COMMENT ON FUNCTION ensure_single_default_api_key() IS 
  'Garante que apenas uma API key seja marcada como default por provedor por usuário.';
