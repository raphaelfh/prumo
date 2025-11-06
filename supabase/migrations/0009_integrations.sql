-- =====================================================
-- MIGRATION: Integrations
-- =====================================================
-- Descrição: Cria tabelas para integrações externas:
-- zotero_integrations
-- =====================================================

-- =================== ZOTERO INTEGRATIONS ===================

CREATE TABLE zotero_integrations (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  zotero_user_id text NOT NULL,
  library_type text NOT NULL CHECK (library_type = ANY (ARRAY['user'::text, 'group'::text])),
  is_active boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  encrypted_api_key text,
  CONSTRAINT zotero_integrations_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

COMMENT ON TABLE zotero_integrations IS 'Integrações Zotero por usuário. API keys criptografadas com AES-GCM pela Edge Function.';
COMMENT ON COLUMN zotero_integrations.encrypted_api_key IS 'API key criptografada com AES-GCM (base64). Criptografia feita pela Edge Function usando Web Crypto API.';
COMMENT ON COLUMN zotero_integrations.zotero_user_id IS 'ID do usuário ou grupo no Zotero';
COMMENT ON COLUMN zotero_integrations.library_type IS 'Tipo de biblioteca: user ou group';

