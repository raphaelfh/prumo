/**
 * Settings → Integrations → Connected apps: the apps the user approved on the
 * OAuth consent page, their access, and a confirmed revoke. Renders one
 * SettingsGroup as its root, like `PersonalAccessTokensGroup`. Connections
 * are created from the app itself, so this group has no create entry point.
 */
import {useState, type MouseEvent} from 'react';
import {Loader2, Trash2} from 'lucide-react';
import {toast} from 'sonner';

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
import {IconButton} from '@/components/patterns/IconButton';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';
import {SettingsGroup} from '@/components/settings';
import {useMyOAuthConnections, useRevokeOAuthConnection} from '@/hooks/user/useOAuthConnections';
import type {OAuthConnectionRead} from '@/services/oauthConnectionsService';
import {relativeTime} from '@/lib/relative-time';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

const STATUS_BADGE = {revoked: 'badgeRevoked', expired: 'badgeExpired'} as const;

function ConnectionRow({row}: {row: OAuthConnectionRead}) {
  const [open, setOpen] = useState(false);
  const revoke = useRevokeOAuthConnection();
  const active = row.status === 'active';
  const onConfirm = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    revoke.mutate(row.id, {
      onSuccess: () => {
        toast.success(t('connectedApps', 'revoked'));
        setOpen(false);
      },
      onError: () => {
        toast.error(t('connectedApps', 'revokeFailed'));
        setOpen(false);
      },
    });
  };
  return (
    <li
      data-muted={!active}
      className={cn(
        'flex flex-col gap-1 rounded-md px-2 py-1.5 text-[13px]',
        '@[30rem]/settings:flex-row @[30rem]/settings:items-center @[30rem]/settings:gap-3 @[30rem]/settings:py-1',
        !active && 'text-muted-foreground',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-[12ch] max-w-full truncate font-medium">{row.client_name}</span>
        <Badge variant="secondary" className="shrink-0">{t('connectedApps', 'badgeRead')}</Badge>
        {row.scope === 'read_write' && (
          <Badge variant="secondary" className="shrink-0">{t('connectedApps', 'badgeEdits')}</Badge>
        )}
        {row.status !== 'active' && (
          <Badge variant="outline" className="shrink-0">{t('connectedApps', STATUS_BADGE[row.status])}</Badge>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <span>
          {row.last_used_at
            ? t('connectedApps', 'lastUsed').replace('{{when}}', relativeTime(row.last_used_at))
            : t('connectedApps', 'neverUsed')}
        </span>
        {active && (
          <div className="ml-auto flex items-center gap-1">
            <AlertDialog open={open} onOpenChange={setOpen}>
              <AlertDialogTrigger asChild>
                <IconButton label={t('connectedApps', 'revokeLabel')} icon={<Trash2 strokeWidth={1.5} />} />
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('connectedApps', 'revokeTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('connectedApps', 'revokeBody').replace('{{name}}', row.client_name)}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('connectedApps', 'revokeCancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={onConfirm} disabled={revoke.isPending} variant="destructive">
                    {revoke.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
                    {t('connectedApps', 'revokeConfirm')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
    </li>
  );
}

export function ConnectedAppsGroup() {
  const connections = useMyOAuthConnections();

  return (
    <SettingsGroup title={t('connectedApps', 'groupTitle')} hint={t('connectedApps', 'groupHint')}>
      {connections.isPending && (
        <ul className="space-y-1" aria-label={t('connectedApps', 'listLoading')}>
          <li><Skeleton className="h-8 w-full" /></li>
          <li><Skeleton className="h-8 w-full" /></li>
        </ul>
      )}

      {connections.isError && (
        <p className="flex items-center gap-2 text-[13px] text-destructive">
          {t('connectedApps', 'listLoadError')}
          <Button size="sm" variant="ghost" onClick={() => void connections.refetch()}>{t('connectedApps', 'retry')}</Button>
        </p>
      )}

      {connections.isSuccess && connections.data.length === 0 && (
        <p className="text-[13px] text-muted-foreground">{t('connectedApps', 'listEmpty')}</p>
      )}

      {connections.isSuccess && connections.data.length > 0 && (
        <ul role="list">
          {connections.data.map((row) => (
            <ConnectionRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </SettingsGroup>
  );
}
