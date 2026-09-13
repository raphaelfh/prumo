/**
 * Zotero integration (Settings → Integrations): one settings group. Connected,
 * it shows the connection's rows and its Test/Disconnect actions; otherwise the
 * credentials form as rows (borderless density pass § 4.3).
 */

import {useState} from 'react';
import {CheckCircle2, ExternalLink, Loader2, Unlink} from 'lucide-react';
import {SettingsActions, SettingsGroup, SettingsRow} from '@/components/settings';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
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
import {useZoteroIntegration} from '@/hooks/useZoteroIntegration';
import {t} from '@/lib/copy';

const maskUserId = (userId: string) =>
  userId.length <= 6 ? userId : `${userId.slice(0, 3)}...${userId.slice(-3)}`;

export function ZoteroIntegrationSection() {
  const {integration, isConfigured, loading, testing, saveCredentials, testConnection, disconnect} =
    useZoteroIntegration();

  const [formData, setFormData] = useState({
    zoteroUserId: '',
    apiKey: '',
    libraryType: 'user' as 'user' | 'group',
  });
  const [showApiKey, setShowApiKey] = useState(false);

  const handleSaveCredentials = async () => {
    if (!formData.zoteroUserId.trim() || !formData.apiKey.trim()) return;
    const success = await saveCredentials(formData);
    if (success) {
      setFormData({zoteroUserId: '', apiKey: '', libraryType: 'user'});
      setShowApiKey(false);
    }
  };

  const title = t('user', 'integrationsZoteroTitle');
  const hint = t('user', 'integrationsZoteroDescription');

  if (loading && !integration) {
    return (
      <SettingsGroup title={title} hint={hint}>
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={1.5}/>
          {t('project', 'zoteroLoading')}
        </p>
      </SettingsGroup>
    );
  }

  if (isConfigured && integration) {
    return (
      <SettingsGroup title={title} hint={hint}>
        <SettingsRow label={t('project', 'zoteroUserId')}>
          <span className="flex items-center gap-2 px-2 text-[13px]">
            <span className="font-mono">{maskUserId(integration.zotero_user_id)}</span>
            <Badge variant="outline" className="gap-1 text-[11px] font-normal">
              <CheckCircle2 className="h-3 w-3" strokeWidth={1.5}/>
              {t('project', 'zoteroConnected')}
            </Badge>
          </span>
        </SettingsRow>
        <SettingsRow label={t('project', 'zoteroLibraryType')}>
          <span className="px-2 text-[13px] capitalize">{integration.library_type}</span>
        </SettingsRow>
        {integration.last_sync_at && (
          <SettingsRow label={t('project', 'zoteroLastSync')}>
            <span className="px-2 text-[13px]">{new Date(integration.last_sync_at).toLocaleString()}</span>
          </SettingsRow>
        )}
        <SettingsActions>
          <Button variant="ghost" size="sm" onClick={() => void testConnection()} disabled={testing}>
            {testing ? (
              <>
                <Loader2 className="animate-spin" strokeWidth={1.5}/>
                {t('project', 'zoteroTesting')}
              </>
            ) : (
              t('project', 'zoteroTestConnection')
            )}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
                <Unlink strokeWidth={1.5}/>
                {t('project', 'zoteroDisconnect')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('project', 'zoteroDisconnectTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('project', 'zoteroDisconnectDescription')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common', 'cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => void disconnect()}>{t('project', 'zoteroDisconnect')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SettingsActions>
      </SettingsGroup>
    );
  }

  return (
    <SettingsGroup title={title} hint={hint}>
      <p className="text-[13px] text-muted-foreground">
        {t('project', 'zoteroConfigureDesc')}{' '}
        <a
          href="https://www.zotero.org/settings/keys/new"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          {t('project', 'zoteroGenerateApiKey')}
          <ExternalLink className="h-3 w-3" strokeWidth={1.5}/>
        </a>
      </p>
      <SettingsRow label={t('project', 'zoteroUserIDLabel')} htmlFor="zotero-user-id" hint={t('project', 'zoteroUserIDHint')}>
        {({describedBy}) => (
          <div className="space-y-1">
            <Input
              id="zotero-user-id"
              variant="quiet"
              aria-describedby={describedBy}
              placeholder={t('project', 'zoteroUserIDPlaceholder')}
              value={formData.zoteroUserId}
              onChange={(e) => setFormData({...formData, zoteroUserId: e.target.value})}
            />
            <a
              href="https://www.zotero.org/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 text-[12px] text-muted-foreground hover:underline"
            >
              {t('project', 'zoteroHowToFind')}
              <ExternalLink className="h-3 w-3" strokeWidth={1.5}/>
            </a>
          </div>
        )}
      </SettingsRow>
      <SettingsRow label={t('project', 'zoteroApiKeyLabel')} htmlFor="api-key" hint={t('project', 'zoteroApiKeyPermissions')}>
        {({describedBy}) => (
          <div className="flex items-center gap-1">
            <Input
              id="api-key"
              variant="quiet"
              aria-describedby={describedBy}
              type={showApiKey ? 'text' : 'password'}
              placeholder="••••••••••••••••••••••••"
              value={formData.apiKey}
              onChange={(e) => setFormData({...formData, apiKey: e.target.value})}
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowApiKey(!showApiKey)}>
              {showApiKey ? t('project', 'zoteroHide') : t('project', 'zoteroShow')}
            </Button>
          </div>
        )}
      </SettingsRow>
      <SettingsRow label={t('project', 'zoteroLibraryTypeLabel')} htmlFor="library-type">
        <Select
          value={formData.libraryType}
          onValueChange={(value: 'user' | 'group') => setFormData({...formData, libraryType: value})}
        >
          <SelectTrigger id="library-type" variant="quiet">
            <SelectValue/>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="user">{t('project', 'zoteroPersonalLibrary')}</SelectItem>
            <SelectItem value="group">{t('project', 'zoteroGroupLibrary')}</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsActions>
        <Button
          size="sm"
          onClick={() => void handleSaveCredentials()}
          disabled={!formData.zoteroUserId.trim() || !formData.apiKey.trim() || loading}
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin" strokeWidth={1.5}/>
              {t('project', 'zoteroSaving')}
            </>
          ) : (
            t('project', 'zoteroConnect')
          )}
        </Button>
      </SettingsActions>
    </SettingsGroup>
  );
}
