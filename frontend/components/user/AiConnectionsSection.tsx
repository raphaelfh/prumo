/**
 * Me → Settings → Integrations → AI connections (spec §5): every connection
 * the viewer owns — hosted keys and custom hosts — in one list, with one
 * Add form: provider (user-scope providers only), docs link, key, host
 * (only when the provider needs one). Replaces the API keys section.
 */
import {useState} from 'react';
import {ExternalLink, Plus} from 'lucide-react';
import {toast} from 'sonner';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Skeleton} from '@/components/ui/skeleton';
import {useCreateMyConnection, useMyConnections, useProviders} from '@/hooks/user/useLlmConnections';
import {t} from '@/lib/copy';
import type {LlmConnectionRead, ProviderRead} from '@/services/llmConnectionsService';

const STATUS_COPY = {
  unverified: 'statusUnverified',
  ok: 'statusOk',
  failed: 'statusFailed',
} as const;

function ConnectionRow({row, provider}: {row: LlmConnectionRead; provider: ProviderRead | undefined}) {
  return (
    <li className="flex items-center gap-3 px-2 py-1.5 text-[13px]">
      <span className="font-medium">{row.label}</span>
      <span className="text-muted-foreground">{provider?.label ?? row.provider}</span>
      {row.base_url && <Badge variant="outline">{t('llmConnections', 'hostTag')}</Badge>}
      <Badge variant={row.validation_status === 'ok' ? 'default' : 'secondary'}>
        {t('llmConnections', STATUS_COPY[row.validation_status])}
      </Badge>
    </li>
  );
}

function AddForm({providers, onDone}: {providers: ProviderRead[]; onDone: () => void}) {
  const create = useCreateMyConnection();
  const [provider, setProvider] = useState(providers[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const spec = providers.find((p) => p.id === provider);
  const submit = () =>
    create.mutate(
      {provider, label, api_key: apiKey === '' ? null : apiKey, base_url: spec?.needs_host ? baseUrl : null, allowed_models: []},
      {
        onSuccess: () => { toast.success(t('llmConnections', 'createSuccess')); onDone(); },
        onError: () => toast.error(t('llmConnections', 'createError')),
      },
    );
  return (
    <form className="space-y-3 rounded-md border border-border/40 p-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="space-y-1.5">
        <Label htmlFor="conn-provider" className="text-[13px] font-medium">{t('llmConnections', 'providerLabel')}</Label>
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger id="conn-provider" className="h-9 text-[13px]"><SelectValue placeholder={t('llmConnections', 'providerPlaceholder')} /></SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.label} <span className="text-[12px] text-muted-foreground">({p.description})</span></SelectItem>
            ))}
          </SelectContent>
        </Select>
        {spec?.docs_url && (
          <a href={spec.docs_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[12px] text-primary hover:underline">
            {t('llmConnections', 'docsLink')}<ExternalLink className="h-3 w-3" strokeWidth={1.5} />
          </a>
        )}
        {spec?.global_key_available && <p className="text-[12px] text-muted-foreground">{t('llmConnections', 'globalKeyNote')}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="conn-label" className="text-[13px] font-medium">{t('llmConnections', 'labelLabel')}</Label>
        <Input id="conn-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('llmConnections', 'labelPlaceholder')} className="h-9 text-[13px]" maxLength={80} />
      </div>
      {spec?.needs_host && (
        <div className="space-y-1.5">
          <Label htmlFor="conn-host" className="text-[13px] font-medium">{t('llmConnections', 'hostLabel')}</Label>
          <Input id="conn-host" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://host/v1" className="h-9 text-[13px]" />
          <p className="text-[12px] text-muted-foreground">{t('llmConnections', 'hostHint')}</p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="conn-key" className="text-[13px] font-medium">{t('llmConnections', 'keyLabel')}</Label>
        <Input id="conn-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          placeholder={spec?.key_optional ? t('llmConnections', 'keyOptionalPlaceholder') : t('llmConnections', 'keyPlaceholder')} className="h-9 text-[13px]" />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={create.isPending || label === '' || (!spec?.key_optional && apiKey === '') || (Boolean(spec?.needs_host) && baseUrl === '')}>
          {create.isPending ? t('llmConnections', 'saving') : t('llmConnections', 'saveButton')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>{t('llmConnections', 'cancelButton')}</Button>
      </div>
    </form>
  );
}

export function AiConnectionsSection() {
  const connections = useMyConnections();
  const providers = useProviders();
  const [adding, setAdding] = useState(false);
  const userProviders = (providers.data ?? []).filter((p) => p.scopes.includes('user'));
  const addButton = (
    <Button size="sm" onClick={() => setAdding(true)} disabled={!providers.data || adding}>
      <Plus className="mr-1 h-4 w-4" strokeWidth={1.5} />{t('llmConnections', 'addButton')}
    </Button>
  );
  return (
    <div className="space-y-3">
      {connections.isPending && (
        <ul className="space-y-0.5" aria-label={t('llmConnections', 'listLoading')}>
          <li><Skeleton className="h-7 w-full" /></li><li><Skeleton className="h-7 w-full" /></li>
        </ul>
      )}
      {connections.isError && (
        <p className="flex items-center gap-2 text-[13px] text-destructive">
          {t('llmConnections', 'listLoadError')}
          <Button size="sm" variant="ghost" onClick={() => void connections.refetch()}>{t('llmConnections', 'retry')}</Button>
        </p>
      )}
      {connections.data && connections.data.length === 0 && !adding && (
        <p className="flex items-center gap-3 text-[13px] text-muted-foreground">{t('llmConnections', 'listEmpty')}{addButton}</p>
      )}
      {connections.data && connections.data.length > 0 && (
        <ul className="divide-y divide-border/40">
          {connections.data.map((row) => (
            <ConnectionRow key={row.id} row={row} provider={providers.data?.find((p) => p.id === row.provider)} />
          ))}
        </ul>
      )}
      {adding ? <AddForm providers={userProviders} onDone={() => setAdding(false)} /> : (connections.data?.length ?? 0) > 0 || connections.isError || connections.isPending ? addButton : null}
    </div>
  );
}
