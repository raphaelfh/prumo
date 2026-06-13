/**
 * Hook to manage user Zotero integration
 */

import {useEffect, useState} from 'react';
import {
  loadZoteroIntegration,
  saveZoteroCredentials,
  testZoteroConnection,
  disconnectZotero,
} from '@/services/zoteroImportService';
import type {ZoteroCredentialsInput, ZoteroIntegration, ZoteroTestConnectionResult} from '@/types/zotero';
import {toast} from 'sonner';
import {t} from '@/lib/copy';

export function useZoteroIntegration() {
  const [integration, setIntegration] = useState<ZoteroIntegration | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

  /**
   * Loads Zotero integration for the current user.
   * IO + try/catch/finally relocated to zoteroImportService.loadZoteroIntegration
   */
  const loadIntegration = async () => {
    setLoading(true);
    const result = await loadZoteroIntegration();
    setLoading(false);
    if (result.ok) {
      setIntegration(result.data.integration);
      setIsConfigured(result.data.isConfigured);
    } else {
      console.error('Error loading integration:', result.error);
      setIntegration(null);
      setIsConfigured(false);
    }
  };

  /**
   * Saves Zotero credentials.
   * IO + try/catch/finally relocated to zoteroImportService.saveZoteroCredentials
   */
  const saveCredentials = async (credentials: ZoteroCredentialsInput) => {
    setLoading(true);
    const result = await saveZoteroCredentials(credentials);
    setLoading(false);
    if (result.ok) {
      toast.success(t('extraction', 'zoteroCredentialsSavedSuccess'));
      await loadIntegration();
      return true;
    }
    console.error('Error saving credentials:', result.error);
    toast.error(result.error.message || t('extraction', 'zoteroCredentialsSaveError'));
    return false;
  };

  /**
   * Tests Zotero connection.
   * IO + try/catch/finally relocated to zoteroImportService.testZoteroConnection
   */
  const testConnection = async (): Promise<ZoteroTestConnectionResult> => {
    setTesting(true);
    const result = await testZoteroConnection();
    setTesting(false);
    if (!result.ok) {
      const errorMsg = result.error.message || t('extraction', 'zoteroTestConnectionError');
      toast.error(errorMsg);
      return {success: false, error: errorMsg};
    }
    const connectionResult = result.data;
    if (connectionResult.success) {
      toast.success(t('extraction', 'zoteroConnectionSuccess').replace('{{name}}', connectionResult.userName || ''));
    } else {
      toast.error(connectionResult.error || t('extraction', 'zoteroConnectionFailed'));
    }
    return connectionResult;
  };

  /**
   * Removes Zotero integration.
   * IO + try/catch/finally relocated to zoteroImportService.disconnectZotero
   */
  const disconnect = async () => {
    setLoading(true);
    const result = await disconnectZotero();
    setLoading(false);
    if (result.ok) {
      toast.success(t('extraction', 'zoteroDisconnectSuccess'));
      setIntegration(null);
      setIsConfigured(false);
      return true;
    }
    console.error('Error disconnecting Zotero:', result.error);
    toast.error(result.error.message || t('extraction', 'zoteroDisconnectError'));
    return false;
  };

  // Load integration on mount
  useEffect(() => {
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void loadIntegration());
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
