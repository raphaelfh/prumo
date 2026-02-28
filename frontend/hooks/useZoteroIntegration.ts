/**
 * Hook para gerenciar integração Zotero do usuário
 */

import {useCallback, useEffect, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {zoteroService} from '@/services/zoteroImportService';
import type {ZoteroCredentialsInput, ZoteroIntegration, ZoteroTestConnectionResult} from '@/types/zotero';
import {toast} from 'sonner';

export function useZoteroIntegration() {
  const [integration, setIntegration] = useState<ZoteroIntegration | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

  /**
   * Carrega integração Zotero do usuário
   */
  const loadIntegration = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setIntegration(null);
        setIsConfigured(false);
        return;
      }

      const { data, error } = await supabase
        .from('zotero_integrations')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        console.error('Erro ao carregar integração Zotero:', error);
        setIntegration(null);
        setIsConfigured(false);
        return;
      }

      setIntegration(data);
      setIsConfigured(!!data);
    } catch (error) {
      console.error('Erro ao carregar integração:', error);
      setIntegration(null);
      setIsConfigured(false);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Salva credenciais do Zotero
   */
  const saveCredentials = useCallback(async (credentials: ZoteroCredentialsInput) => {
    setLoading(true);
    try {
      await zoteroService.saveCredentials(credentials);
      toast.success('Credenciais salvas com sucesso!');
      await loadIntegration();
      return true;
    } catch (error: any) {
      console.error('Erro ao salvar credenciais:', error);
      toast.error(error.message || 'Erro ao salvar credenciais');
      return false;
    } finally {
      setLoading(false);
    }
  }, [loadIntegration]);

  /**
   * Testa conexão com Zotero
   */
  const testConnection = useCallback(async (): Promise<ZoteroTestConnectionResult> => {
    setTesting(true);
    try {
      const result = await zoteroService.testConnection();
      
      if (result.success) {
        toast.success(`Conexão bem-sucedida! Usuário: ${result.userName}`);
      } else {
        toast.error(result.error || 'Falha ao conectar com Zotero');
      }
      
      return result;
    } catch (error: any) {
      const errorMsg = error.message || 'Erro ao testar conexão';
      toast.error(errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    } finally {
      setTesting(false);
    }
  }, []);

  /**
   * Remove integração Zotero
   */
  const disconnect = useCallback(async () => {
    setLoading(true);
    try {
      await zoteroService.disconnect();
      toast.success('Integração Zotero removida');
      setIntegration(null);
      setIsConfigured(false);
      return true;
    } catch (error: any) {
      console.error('Erro ao desconectar:', error);
      toast.error(error.message || 'Erro ao remover integração');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // Carregar integração ao montar
  useEffect(() => {
    loadIntegration();
  }, [loadIntegration]);

  return {
    integration,
    isConfigured,
    loading,
    testing,
    loadIntegration,
    saveCredentials,
    testConnection,
    disconnect,
  };
}

