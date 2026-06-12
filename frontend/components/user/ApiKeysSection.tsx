/**
 * API Keys section
 * Gerenciar API keys de provedores de IA (OpenAI, Anthropic, Gemini, Grok)
 */

import {useEffect, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Badge} from '@/components/ui/badge';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {Collapsible, CollapsibleContent, CollapsibleTrigger,} from '@/components/ui/collapsible';
import {
    CheckCircle2,
    ChevronDown,
    Clock,
    ExternalLink,
    Eye,
    EyeOff,
    Key,
    Loader2,
    Plus,
    RefreshCw,
    Star,
    StarOff,
    Trash2,
    XCircle,
} from 'lucide-react';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {getAccessToken} from '@/services/authService';
import {
    type APIKeyInfo, type CreateAPIKeyRequest, type ProviderInfo,
    loadKeysAndProviders, createApiKey, setDefaultApiKey, deleteApiKey, validateApiKey,
} from '@/services/apiKeysService';

export function ApiKeysSection() {
  const [keys, setKeys] = useState<APIKeyInfo[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState<string | null>(null);
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  
  const [formData, setFormData] = useState<CreateAPIKeyRequest>({
    provider: 'openai',
    apiKey: '',
    keyName: '',
    isDefault: true,
    validateKey: true,
  });

  const loadData = async () => {
    setLoading(true);
    const tokenResult = await getAccessToken();
    if (!tokenResult.ok) {
      toast.error(tokenResult.error.message || t('user', 'apiKeysSessionExpired'));
      setLoading(false);
      return;
    }
    const result = await loadKeysAndProviders(tokenResult.data);
    setLoading(false);
    if (!result.ok) {
      console.error('Error loading API keys:', result.error);
      toast.error(t('user', 'apiKeysErrorLoading'));
      return;
    }
    setKeys(result.data.keys);
    setProviders(result.data.providers);
  };

  // Load initial data
  useEffect(() => {
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void loadData());
  }, []);

  const handleAddKey = async () => {
    if (!formData.apiKey.trim()) {
      toast.error(t('user', 'apiKeysEnterKey'));
      return;
    }
    setSaving(true);
    const tokenResult = await getAccessToken();
    if (!tokenResult.ok) {
      toast.error(tokenResult.error.message || t('user', 'apiKeysSessionExpired'));
      setSaving(false);
      return;
    }
    const result = await createApiKey(tokenResult.data, formData);
    setSaving(false);
    if (!result.ok) {
      console.error('Error adding API key:', result.error);
      toast.error(result.error.message || t('user', 'apiKeysErrorAdding'));
      return;
    }
    const created = result.data;
    if (created.validationStatus === 'invalid') {
      toast.error(`${t('user', 'apiKeysInvalidKey')}: ${created.validationMessage || ''}`);
    } else if (created.validationStatus === 'valid') {
      toast.success(t('user', 'apiKeysAddedValidated'));
    } else {
      toast.success(t('user', 'apiKeysAddedPending'));
    }
    setFormData({provider: 'openai', apiKey: '', keyName: '', isDefault: true, validateKey: true});
    setShowApiKey(false);
    setIsAddFormOpen(false);
    await loadData();
  };

  const handleSetDefault = async (keyId: string) => {
    const tokenResult = await getAccessToken();
    if (!tokenResult.ok) {
      toast.error(tokenResult.error.message || t('user', 'apiKeysSessionExpired'));
      return;
    }
    const result = await setDefaultApiKey(tokenResult.data, keyId);
    if (!result.ok) {
      console.error('Error setting as default:', result.error);
      toast.error(result.error.message || t('user', 'apiKeysErrorSetDefault'));
      return;
    }
    toast.success(t('user', 'apiKeysSetDefault'));
    await loadData();
  };

  const handleDelete = async (keyId: string) => {
    const tokenResult = await getAccessToken();
    if (!tokenResult.ok) {
      toast.error(tokenResult.error.message || t('user', 'apiKeysSessionExpired'));
      return;
    }
    const result = await deleteApiKey(tokenResult.data, keyId);
    if (!result.ok) {
      console.error('Error removing:', result.error);
      toast.error(result.error.message || t('user', 'apiKeysErrorRemoving'));
      return;
    }
    toast.success(t('user', 'apiKeysRemoved'));
    await loadData();
  };

  const handleValidate = async (keyId: string) => {
    setValidating(keyId);
    const tokenResult = await getAccessToken();
    if (!tokenResult.ok) {
      toast.error(tokenResult.error.message || t('user', 'apiKeysSessionExpired'));
      setValidating(null);
      return;
    }
    const result = await validateApiKey(tokenResult.data, keyId);
    setValidating(null);
    if (!result.ok) {
      console.error('Error validating API key:', result.error);
      toast.error(result.error.message || t('user', 'apiKeysErrorValidating'));
      return;
    }
    const validation = result.data;
    if (validation.status === 'valid') {
      toast.success(t('user', 'apiKeysValid'));
    } else if (validation.status === 'invalid') {
      toast.error(`${t('user', 'apiKeysInvalidKey')}: ${validation.message}`);
    } else {
      toast.info(t('user', 'apiKeysValidationPending'));
    }
    await loadData();
  };

  const getValidationBadge = (status: string | null) => {
    switch (status) {
      case 'valid':
        return (
            <Badge variant="outline"
                   className="gap-1 text-[11px] font-normal text-success border-success/30 bg-success/10">
                <CheckCircle2 className="h-3 w-3" strokeWidth={1.5}/>
                {t('user', 'apiKeysBadgeValid')}
          </Badge>
        );
      case 'invalid':
        return (
            <Badge variant="outline"
                   className="gap-1 text-[11px] font-normal text-destructive border-destructive/30 bg-destructive/10">
                <XCircle className="h-3 w-3" strokeWidth={1.5}/>
                {t('user', 'apiKeysBadgeInvalid')}
          </Badge>
        );
      default:
        return (
            <Badge variant="outline"
                   className="gap-1 text-[11px] font-normal text-warning border-warning/30 bg-warning/10">
                <Clock className="h-3 w-3" strokeWidth={1.5}/>
                {t('user', 'apiKeysBadgePending')}
          </Badge>
        );
    }
  };

  const getProviderName = (providerId: string) => {
    return providers.find(p => p.id === providerId)?.name || providerId;
  };

  const getProviderDocsUrl = (providerId: string) => {
    return providers.find(p => p.id === providerId)?.docsUrl || '#';
  };

  // Agrupar keys por provedor
  const keysByProvider = keys.reduce((acc, key) => {
    if (!acc[key.provider]) {
      acc[key.provider] = [];
    }
    acc[key.provider].push(key);
    return acc;
  }, {} as Record<string, APIKeyInfo[]>);

  if (loading) {
    return (
        <div className="flex items-center gap-2 py-4 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" strokeWidth={1.5}/>
            {t('user', 'apiKeysLoading')}
        </div>
    );
  }

  return (
      <div className="space-y-5">
          <p className="text-[12px] text-muted-foreground">
              {t('user', 'apiKeysEncryptedNote')}
          </p>

        <Collapsible open={isAddFormOpen} onOpenChange={setIsAddFormOpen}>
          <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="w-full justify-between h-9 text-[13px]">
              <span className="flex items-center gap-2">
                <Plus className="h-4 w-4" strokeWidth={1.5}/>
                  {t('user', 'apiKeysAddButton')}
              </span>
                  <ChevronDown
                      className={`h-4 w-4 transition-transform duration-75 ${isAddFormOpen ? 'rotate-180' : ''}`}
                      strokeWidth={1.5}/>
            </Button>
          </CollapsibleTrigger>

            <CollapsibleContent className="mt-3 space-y-3 border border-border/40 rounded-md p-4">
                <div className="space-y-1.5">
                    <Label className="text-[13px] font-medium">{t('user', 'apiKeysProviderLabel')}</Label>
              <Select
                value={formData.provider}
                onValueChange={(value) => setFormData({ ...formData, provider: value })}
              >
                  <SelectTrigger className="h-9 text-[13px]">
                      <SelectValue placeholder={t('user', 'apiKeysProviderPlaceholder')}/>
                </SelectTrigger>
                <SelectContent>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      <div className="flex items-center gap-2">
                        <span>{provider.name}</span>
                          <span className="text-[12px] text-muted-foreground">
                          ({provider.description})
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <a
                href={getProviderDocsUrl(formData.provider)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] text-primary hover:underline flex items-center gap-1"
              >
                  {t('user', 'apiKeysHowToGet')}
                  <ExternalLink className="h-3 w-3" strokeWidth={1.5}/>
              </a>
            </div>

                <div className="space-y-1.5">
                    <Label className="text-[13px] font-medium">{t('user', 'apiKeysKeyLabel')}</Label>
              <div className="relative">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={formData.apiKey}
                  onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                  placeholder={t('user', 'apiKeysKeyPlaceholder')}
                  className="pr-10 h-9 text-[13px]"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1 h-7"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                    {showApiKey ? <EyeOff className="h-4 w-4" strokeWidth={1.5}/> :
                        <Eye className="h-4 w-4" strokeWidth={1.5}/>}
                </Button>
              </div>
            </div>

                <div className="space-y-1.5">
                    <Label className="text-[13px] font-medium">{t('user', 'apiKeysNameLabel')}</Label>
              <Input
                value={formData.keyName || ''}
                onChange={(e) => setFormData({ ...formData, keyName: e.target.value })}
                placeholder={t('user', 'apiKeysNamePlaceholder')}
                className="h-9 text-[13px]"
              />
            </div>

            <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={formData.isDefault}
                  onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                  className="rounded border-border/40"
                />
                    {t('user', 'apiKeysSetAsDefault')}
              </label>

                <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={formData.validateKey}
                  onChange={(e) => setFormData({ ...formData, validateKey: e.target.checked })}
                  className="rounded border-border/40"
                />
                    {t('user', 'apiKeysValidateBeforeSave')}
              </label>
            </div>

            <Button
              onClick={handleAddKey}
              disabled={saving || !formData.apiKey.trim()}
              className="w-full h-9 text-[13px]"
            >
              {saving ? (
                <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5}/>
                    {t('user', 'apiKeysSaving')}
                </>
              ) : (
                <>
                    <Plus className="mr-2 h-4 w-4" strokeWidth={1.5}/>
                    {t('user', 'apiKeysAddButton')}
                </>
              )}
            </Button>
          </CollapsibleContent>
        </Collapsible>

          {/* Keys list: one block with divide-y, each row = one key */}
          {keys.length > 0 ? (
              <div className="rounded-md border border-border/40 divide-y divide-border/40">
                  {Object.entries(keysByProvider).flatMap(([providerId, providerKeys]) => [
                      <h4 key={`h-${providerId}`}
                          className="text-[12px] font-medium text-muted-foreground px-2 pt-2 pb-1 first:pt-0">
                          {getProviderName(providerId)}
                      </h4>,
                      ...providerKeys.map((key) => (
                          <div
                              key={key.id}
                              className={`flex items-center justify-between py-2 px-2 transition-colors duration-75 hover:bg-muted/50 ${
                                  !key.isActive ? 'opacity-50' : ''
                              }`}
                          >
                              <div className="flex items-center gap-2.5 min-w-0">
                                  {key.isDefault && (
                                      <Star className="h-4 w-4 text-amber-500 fill-amber-500 shrink-0"
                                            strokeWidth={1.5}/>
                                  )}
                                  <div className="min-w-0">
                                      <p className="text-[13px] font-medium truncate">
                                          {key.keyName || `${t('user', 'apiKeysKeyLabelFallback')} ${key.id.slice(0, 8)}`}
                                      </p>
                                      <p className="text-[12px] text-muted-foreground">
                                          {t('user', 'apiKeysCreatedOn')} {new Date(key.createdAt).toLocaleDateString()}
                                          {key.lastUsedAt && (
                                              <> · {t('user', 'apiKeysLastUsed')} {new Date(key.lastUsedAt).toLocaleDateString()}</>
                                          )}
                                      </p>
                                  </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                  {getValidationBadge(key.validationStatus)}
                                  <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 w-8 p-0"
                                      onClick={() => handleValidate(key.id)}
                                      disabled={validating === key.id}
                                      title={t('user', 'apiKeysTitleRevalidate')}
                                  >
                                      {validating === key.id ? (
                                          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5}/>
                                      ) : (
                                          <RefreshCw className="h-4 w-4" strokeWidth={1.5}/>
                                      )}
                                  </Button>
                                  {!key.isDefault && key.isActive && (
                                      <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 w-8 p-0"
                                          onClick={() => handleSetDefault(key.id)}
                                          title={t('user', 'apiKeysTitleSetDefault')}
                                      >
                                          <StarOff className="h-4 w-4" strokeWidth={1.5}/>
                                      </Button>
                                  )}
                                  <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                          <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                              title={t('user', 'apiKeysTitleRemove')}
                                          >
                                              <Trash2 className="h-4 w-4" strokeWidth={1.5}/>
                                          </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                          <AlertDialogHeader>
                                              <AlertDialogTitle>{t('user', 'apiKeysRemoveTitle')}</AlertDialogTitle>
                                              <AlertDialogDescription>
                                                  {t('user', 'apiKeysRemoveDescription')}
                                              </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                              <AlertDialogCancel>{t('common', 'cancel')}</AlertDialogCancel>
                                              <AlertDialogAction
                                                  onClick={() => handleDelete(key.id)}
                                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                              >
                                                  {t('user', 'apiKeysTitleRemove')}
                                              </AlertDialogAction>
                                          </AlertDialogFooter>
                                      </AlertDialogContent>
                                  </AlertDialog>
                              </div>
                          </div>
                      )),
                  ])}
              </div>
          ) : (
              <div className="text-center py-6 text-muted-foreground">
                  <Key className="h-10 w-10 mx-auto mb-2 opacity-40" strokeWidth={1.5}/>
                  <p className="text-[13px]">{t('user', 'apiKeysNoKeys')}</p>
                  <p className="text-[12px] mt-0.5">
                      {t('user', 'apiKeysNoKeysHint')}
                  </p>
              </div>
          )}
      </div>
  );
}
