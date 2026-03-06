/**
 * Zotero integration section — configure credentials and test connection.
 */

import {useState} from 'react';
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
import {CheckCircle2, ExternalLink, Loader2, Unlink} from 'lucide-react';
import {useZoteroIntegration} from '@/hooks/useZoteroIntegration';
import {t} from '@/lib/copy';

export function ZoteroIntegrationSection() {
  const {
    integration,
    isConfigured,
    loading,
    testing,
    saveCredentials,
    testConnection,
    disconnect,
  } = useZoteroIntegration();

  const [formData, setFormData] = useState({
    zoteroUserId: '',
    apiKey: '',
    libraryType: 'user' as 'user' | 'group',
  });

  const [showApiKey, setShowApiKey] = useState(false);

  const handleSaveCredentials = async () => {
    if (!formData.zoteroUserId.trim() || !formData.apiKey.trim()) {
      return;
    }

    const success = await saveCredentials(formData);
    
    if (success) {
      // Limpar form
      setFormData({
        zoteroUserId: '',
        apiKey: '',
        libraryType: 'user',
      });
      setShowApiKey(false);
    }
  };

  const handleTestConnection = async () => {
    await testConnection();
  };

  const handleDisconnect = async () => {
    await disconnect();
  };

  const maskUserId = (userId: string) => {
    if (userId.length <= 6) return userId;
    return `${userId.slice(0, 3)}...${userId.slice(-3)}`;
  };

  if (loading && !integration) {
    return (
        <div className="flex items-center gap-2 py-4 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" strokeWidth={1.5}/>
            {t('project', 'zoteroLoading')}
        </div>
    );
  }

  return (
      <div className="space-y-4">
          {isConfigured && integration ? (
              <>
                  <div className="rounded-md border border-border/40 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                          <Badge variant="outline" className="gap-1 text-[11px] font-normal">
                              <CheckCircle2 className="h-3 w-3" strokeWidth={1.5}/>
                              {t('project', 'zoteroConnected')}
                          </Badge>
                      </div>
                      <div className="text-[13px] text-muted-foreground space-y-1">
                          <p><span
                              className="text-[12px] text-muted-foreground/80">{t('project', 'zoteroUserId')}</span>
                              <span
                                  className="font-mono text-foreground">{maskUserId(integration.zotero_user_id)}</span>
                          </p>
                          <p><span
                              className="text-[12px] text-muted-foreground/80">{t('project', 'zoteroLibraryType')}</span>
                              <span className="capitalize">{integration.library_type}</span></p>
              {integration.last_sync_at && (
                  <p><span
                      className="text-[12px] text-muted-foreground/80">{t('project', 'zoteroLastSync')}</span> {new Date(integration.last_sync_at).toLocaleString()}
                  </p>
              )}
                      </div>
                  </div>

                  <div className="flex gap-2">
                      <Button
                          variant="outline"
                          size="sm"
                          className="h-9 text-[13px]"
                          onClick={handleTestConnection}
                          disabled={testing}
                      >
                          {testing ? (
                              <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5}/>
                                  {t('project', 'zoteroTesting')}
                              </>
                          ) : (
                              t('project', 'zoteroTestConnection')
                          )}
                      </Button>
                      <AlertDialog>
                          <AlertDialogTrigger asChild>
                              <Button variant="outline" size="sm"
                                      className="h-9 text-[13px] text-muted-foreground hover:text-destructive">
                                  <Unlink className="mr-2 h-4 w-4" strokeWidth={1.5}/>
                                  {t('project', 'zoteroDisconnect')}
                              </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                              <AlertDialogHeader>
                                  <AlertDialogTitle>{t('project', 'zoteroDisconnectTitle')}</AlertDialogTitle>
                                  <AlertDialogDescription>
                                      {t('project', 'zoteroDisconnectDescription')}
                                  </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                  <AlertDialogCancel>{t('common', 'cancel')}</AlertDialogCancel>
                                  <AlertDialogAction onClick={handleDisconnect}>
                                      {t('project', 'zoteroDisconnect')}
                                  </AlertDialogAction>
                              </AlertDialogFooter>
                          </AlertDialogContent>
                      </AlertDialog>
                  </div>
              </>
          ) : (
              <>
                  <p className="text-[12px] text-muted-foreground">
                      {t('project', 'zoteroConfigureDesc')}{' '}
                      <a
                          href="https://www.zotero.org/settings/keys/new"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                          {t('project', 'zoteroGenerateApiKey')}
                          <ExternalLink className="h-3 w-3" strokeWidth={1.5}/>
                      </a>
                  </p>

                  <div className="rounded-md border border-border/40 p-4 space-y-4">
                      <div className="space-y-1.5">
                          <Label htmlFor="zotero-user-id" className="text-[13px] font-medium">
                              {t('project', 'zoteroUserIDLabel')}
                              <a
                                  href="https://www.zotero.org/settings/keys"
                                  target="_blank"
                    rel="noopener noreferrer"
                                  className="ml-2 text-[12px] text-muted-foreground hover:underline inline-flex items-center gap-1 font-normal"
                  >
                                  {t('project', 'zoteroHowToFind')}
                                  <ExternalLink className="h-3 w-3" strokeWidth={1.5}/>
                  </a>
                </Label>
                <Input
                  id="zotero-user-id"
                  placeholder={t('project', 'zoteroUserIDPlaceholder')}
                  value={formData.zoteroUserId}
                  onChange={(e) => setFormData({ ...formData, zoteroUserId: e.target.value })}
                  className="h-9 text-[13px]"
                />
                          <p className="text-[12px] text-muted-foreground">
                              {t('project', 'zoteroUserIDHint')}
                </p>
              </div>

                      <div className="space-y-1.5">
                          <Label htmlFor="api-key"
                                 className="text-[13px] font-medium">{t('project', 'zoteroApiKeyLabel')}</Label>
                <div className="relative">
                  <Input
                    id="api-key"
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="••••••••••••••••••••••••"
                    value={formData.apiKey}
                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    className="pr-20 h-9 text-[13px]"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1 h-7 text-[12px]"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                      {showApiKey ? t('project', 'zoteroHide') : t('project', 'zoteroShow')}
                  </Button>
                </div>
                          <p className="text-[12px] text-muted-foreground">
                              {t('project', 'zoteroApiKeyPermissions')}
                </p>
              </div>

                      <div className="space-y-1.5">
                          <Label htmlFor="library-type"
                                 className="text-[13px] font-medium">{t('project', 'zoteroLibraryTypeLabel')}</Label>
                          <Select
                              value={formData.libraryType}
                              onValueChange={(value: 'user' | 'group') =>
                    setFormData({ ...formData, libraryType: value })
                  }
                >
                              <SelectTrigger id="library-type" className="h-9 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                      <SelectItem value="user">{t('project', 'zoteroPersonalLibrary')}</SelectItem>
                      <SelectItem value="group">{t('project', 'zoteroGroupLibrary')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

                      <div className="flex gap-2 pt-1">
                          <Button
                  onClick={handleSaveCredentials}
                  disabled={!formData.zoteroUserId.trim() || !formData.apiKey.trim() || loading}
                  className="h-9 text-[13px]"
                >
                  {loading ? (
                    <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5}/>
                        {t('project', 'zoteroSaving')}
                    </>
                  ) : (
                      t('project', 'zoteroConnect')
                  )}
                </Button>
              </div>
                  </div>
              </>
          )}
      </div>
  );
}

