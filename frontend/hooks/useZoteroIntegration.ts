/**
 * Hook to manage user Zotero integration
 */

import {useCallback, useEffect, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {zoteroService} from '@/services/zoteroImportService';
import type {ZoteroCredentialsInput, ZoteroIntegration, ZoteroTestConnectionResult} from '@/types/zotero';
import {toast} from 'sonner';
import {t} from '@/lib/copy';

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
          console.error('Error loading Zotero integration:', error);
        setIntegration(null);
        setIsConfigured(false);
        return;
      }

      setIntegration(data);
      setIsConfigured(!!data);
    } catch (error) {
        console.error('Error loading integration:', error);
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
        toast.success(t('extraction', 'zoteroCredentialsSavedSuccess'));
      await loadIntegration();
      return true;
    } catch (error: any) {
        console.error('Error saving credentials:', error);
        toast.error(error.message || t('extraction', 'zoteroCredentialsSaveError'));
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
          toast.success(t('extraction', 'zoteroConnectionSuccess').replace('{{name}}', result.userName || ''));
      } else {
          toast.error(result.error || t('extraction', 'zoteroConnectionFailed'));
      }
      
      return result;
    } catch (error: any) {
        const errorMsg = error.message || t('extraction', 'zoteroTestConnectionError');
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
        toast.success(t('extraction', 'zoteroDisconnectSuccess'));
      setIntegration(null);
      setIsConfigured(false);
      return true;
    } catch (error: any) {
        console.error('Error disconnecting Zotero:', error);
        toast.error(error.message || t('extraction', 'zoteroDisconnectError'));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

    // Load integration on mount
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

