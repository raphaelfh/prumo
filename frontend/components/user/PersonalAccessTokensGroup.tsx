/**
 * Settings → Integrations → Personal access tokens (spec §4.5, §4.7): list,
 * create, revoke, and the one-time secret reveal. Renders one SettingsGroup
 * as its root (borderless density pass § 4.3). `CopyBlock` is exported here
 * so Task 4b can import it before extracting it to a shared location.
 */
import {useState, type MouseEvent} from 'react';
import {Plus, Trash2} from 'lucide-react';
import {toast} from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {IconButton} from '@/components/patterns/IconButton';
import {AppDialog} from '@/components/patterns/AppDialog';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Skeleton} from '@/components/ui/skeleton';
import {SettingsActions, SettingsGroup, SettingsRow} from '@/components/settings';
import {useCopyToClipboard} from '@/hooks/useCopyToClipboard';
import {
  useCreateMyToken,
  useMyTokens,
  useRevokeMyToken,
} from '@/hooks/user/usePersonalAccessTokens';
import {isTokenLimitError, type PersonalAccessTokenRead} from '@/services/personalAccessTokenService';
import {relativeTime} from '@/lib/relative-time';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

const EXPIRY_OPTIONS = [30, 90, 365] as const;
const SCOPE_COPY = {read: 'scopeRead', read_write: 'scopeReadWrite'} as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US');
}

export function CopyBlock({label, code, copyAriaLabel}: {label: string; code: string; copyAriaLabel?: string}) {
  const {copied, copy} = useCopyToClipboard();
  return (
    <div className="space-y-1">
      <p className="text-[13px] font-medium">{label}</p>
      <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12px]">{code}</pre>
        <Button type="button" size="sm" variant="ghost" onClick={() => copy(code)} aria-label={copyAriaLabel ?? t('personalAccessTokens', 'copy')}>
          {copied ? t('personalAccessTokens', 'copied') : t('personalAccessTokens', 'copy')}
        </Button>
      </div>
    </div>
  );
}

function TokenRow({row}: {row: PersonalAccessTokenRead}) {
  const [open, setOpen] = useState(false);
  const revoke = useRevokeMyToken();
  const onConfirm = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    revoke.mutate(row.id, {
      onSuccess: () => {
        toast.success(t('personalAccessTokens', 'revokeSuccess'));
        setOpen(false);
      },
      onError: (error) => {
        toast.error(error.message || t('personalAccessTokens', 'revokeError'));
        setOpen(false);
      },
    });
  };
  return (
    <li
      data-muted={row.status !== 'active'}
      className={cn(
        'flex items-center gap-3 rounded-md px-2 py-1 text-[13px]',
        row.status !== 'active' && 'text-muted-foreground opacity-70',
      )}
    >
      <span className="font-medium">{row.name}</span>
      <code className="text-[12px] text-muted-foreground">{row.token_prefix}…</code>
      <Badge variant="secondary">{t('personalAccessTokens', SCOPE_COPY[row.scope])}</Badge>
      {row.status === 'active' && (
        <>
          <span className="text-muted-foreground">{t('personalAccessTokens', 'expiresOn').replace('{{date}}', formatDate(row.expires_at))}</span>
          <span className="text-muted-foreground">
            {row.last_used_at
              ? t('personalAccessTokens', 'lastUsed').replace('{{when}}', relativeTime(row.last_used_at))
              : t('personalAccessTokens', 'neverUsed')}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <AlertDialog open={open} onOpenChange={setOpen}>
              <AlertDialogTrigger asChild>
                <IconButton label={t('personalAccessTokens', 'revokeAria')} icon={<Trash2 strokeWidth={1.5} />} />
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('personalAccessTokens', 'revokeTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('personalAccessTokens', 'revokeDescription').replace('{{name}}', row.name)}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogAction onClick={onConfirm} disabled={revoke.isPending}>
                    {revoke.isPending ? t('personalAccessTokens', 'revoking') : t('personalAccessTokens', 'revokeConfirm')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </>
      )}
      {row.status === 'expired' && (
        <Badge variant="outline">{t('personalAccessTokens', 'expiredBadge').replace('{{date}}', formatDate(row.expires_at))}</Badge>
      )}
      {row.status === 'revoked' && row.revoked_at && (
        <Badge variant="outline">{t('personalAccessTokens', 'revokedBadge').replace('{{date}}', formatDate(row.revoked_at))}</Badge>
      )}
    </li>
  );
}

function CreateDialog({
  open,
  onOpenChange,
  onCreated,
  create,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (secret: string) => void;
  create: ReturnType<typeof useCreateMyToken>;
}) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'read_write'>('read');
  const [expiresInDays, setExpiresInDays] = useState<(typeof EXPIRY_OPTIONS)[number]>(90);
  const [formError, setFormError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setScope('read');
    setExpiresInDays(90);
    setFormError(null);
  };
  const cancel = () => {
    reset();
    onOpenChange(false);
  };
  const submit = () => {
    setFormError(null);
    create.mutate(
      {name: name.trim(), scope, expires_in_days: expiresInDays},
      {
        onSuccess: (data) => {
          reset();
          onOpenChange(false);
          onCreated(data.secret);
        },
        onError: (error) => {
          setFormError(isTokenLimitError(error) ? t('personalAccessTokens', 'createLimitError') : error.message || t('personalAccessTokens', 'createError'));
        },
      },
    );
  };

  return (
    <AppDialog open={open} onOpenChange={(next) => { if (!next) cancel(); }} size="sm" title={t('personalAccessTokens', 'createTitle')} showFooter={false}>
      <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <SettingsRow label={t('personalAccessTokens', 'nameLabel')} htmlFor="pat-name">
          <Input id="pat-name" variant="quiet" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('personalAccessTokens', 'namePlaceholder')} maxLength={80} />
        </SettingsRow>
        <SettingsRow label={t('personalAccessTokens', 'scopeLabel')} htmlFor="pat-scope">
          <Select value={scope} onValueChange={(next) => setScope(next as 'read' | 'read_write')}>
            <SelectTrigger id="pat-scope" variant="quiet">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="read">{t('personalAccessTokens', 'scopeRead')}</SelectItem>
              <SelectItem value="read_write">{t('personalAccessTokens', 'scopeReadWrite')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label={t('personalAccessTokens', 'expiryLabel')} htmlFor="pat-expiry">
          <Select value={String(expiresInDays)} onValueChange={(next) => setExpiresInDays(Number(next) as (typeof EXPIRY_OPTIONS)[number])}>
            <SelectTrigger id="pat-expiry" variant="quiet">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPIRY_OPTIONS.map((days) => (
                <SelectItem key={days} value={String(days)}>{t('personalAccessTokens', 'expiryDays').replace('{{n}}', String(days))}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        {formError && <p role="alert" className="text-[13px] text-destructive">{formError}</p>}
        <SettingsActions>
          <Button type="submit" size="sm" disabled={create.isPending || name.trim() === ''}>
            {create.isPending ? t('personalAccessTokens', 'creating') : t('personalAccessTokens', 'createSubmit')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={cancel}>{t('personalAccessTokens', 'cancel')}</Button>
        </SettingsActions>
      </form>
    </AppDialog>
  );
}

export function PersonalAccessTokensGroup() {
  const tokens = useMyTokens();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const create = useCreateMyToken();

  const closeReveal = () => {
    setSecret(null);
    create.reset();
  };

  const createButton = (
    <Button size="sm" variant="ghost" onClick={() => setCreating(true)} disabled={tokens.isPending}>
      <Plus className="mr-1 h-4 w-4" strokeWidth={1.5} />{t('personalAccessTokens', 'createButton')}
    </Button>
  );

  return (
    <SettingsGroup title={t('personalAccessTokens', 'groupTitle')} hint={t('personalAccessTokens', 'groupHint')}>
      <p className="text-[13px] text-muted-foreground">{t('personalAccessTokens', 'clientsNote')}</p>
      <p className="text-[13px] text-muted-foreground">{t('personalAccessTokens', 'readRecommendation')}</p>

      {tokens.isPending && (
        <ul className="space-y-1" aria-label={t('personalAccessTokens', 'listLoading')}>
          <li><Skeleton className="h-8 w-full" /></li>
          <li><Skeleton className="h-8 w-full" /></li>
        </ul>
      )}

      {tokens.isError && (
        <p className="flex items-center gap-2 text-[13px] text-destructive">
          {t('personalAccessTokens', 'listLoadError')}
          <Button size="sm" variant="ghost" onClick={() => void tokens.refetch()}>{t('personalAccessTokens', 'retry')}</Button>
        </p>
      )}

      {!tokens.isError && tokens.data && tokens.data.length === 0 && (
        <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
          <span>{t('personalAccessTokens', 'listEmpty')}</span>
        </div>
      )}

      {!tokens.isError && tokens.data && tokens.data.length > 0 && (
        <ul role="list">
          {tokens.data.map((row) => (
            <TokenRow key={row.id} row={row} />
          ))}
        </ul>
      )}

      {createButton}

      <CreateDialog open={creating} onOpenChange={setCreating} onCreated={setSecret} create={create} />

      <Dialog open={secret !== null} onOpenChange={() => {}}>
        <DialogContent
          size="md"
          showCloseButton={false}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className="space-y-3">
            <div>
              <h2 className="text-[15px] font-medium">{t('personalAccessTokens', 'revealTitle')}</h2>
              <p className="text-[13px] text-muted-foreground">{t('personalAccessTokens', 'revealWarning')}</p>
            </div>
            {secret && <CopyBlock label={t('personalAccessTokens', 'copyTokenAria')} code={secret} copyAriaLabel={t('personalAccessTokens', 'copyTokenAria')} />}
            <div className="flex justify-end">
              <Button size="sm" onClick={closeReveal}>{t('personalAccessTokens', 'revealDone')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </SettingsGroup>
  );
}
