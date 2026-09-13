/**
 * Project → Configuration → AI engine (spec 2026-09-13 §4.3): the project
 * DEFAULT (a catalogue pair), its mode and the lock as rows, then Shared keys —
 * the project's hosted-provider keys, every provider with "project" in its
 * scopes, llama_cloud included, each tagged by what it serves. Each group's
 * read loads and fails independently of the other's, inside its own group.
 */
import {Plus, Trash2} from 'lucide-react';
import {useState} from 'react';
import {toast} from 'sonner';

import {SettingsActions, SettingsGroup, SettingsPage, SettingsRow} from '@/components/settings';
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
import {Input} from '@/components/ui/input';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Skeleton} from '@/components/ui/skeleton';
import {Switch} from '@/components/ui/switch';
import {useLlmEngine, useSetLlmEngine} from '@/hooks/extraction/useLlmEngine';
import {
  useCreateProjectConnection,
  useDeleteProjectConnection,
  useProjectConnections,
} from '@/hooks/project/useProjectConnections';
import {useProviders} from '@/hooks/user/useLlmConnections';
import {useProjectMemberRole} from '@/hooks/useProjectMemberRole';
import {t} from '@/lib/copy';
import type {ProviderRead} from '@/services/llmConnectionsService';
import type {LlmEngineRead} from '@/services/llmEngineService';

const SERVES_COPY = {llm: 'servesLlm', parsing: 'servesParsing'} as const;
// `/me/providers` does not carry `serves` (spec §4 field list); `llama_cloud`
// is the registry's only parsing provider (registry §1).
const servesOf = (provider: ProviderRead | undefined) => (provider?.id === 'llama_cloud' ? 'parsing' : 'llm');

function EngineCard({
  projectId,
  read,
  isManager,
  providers,
}: {
  projectId: string;
  read: LlmEngineRead;
  isManager: boolean;
  providers: ProviderRead[];
}) {
  const save = useSetLlmEngine(projectId);
  const label = (p: string, m: string) =>
    read.catalog.find((e) => e.provider === p && e.model === m)?.label ?? `${p}:${m}`;
  const write = (
    patch: Partial<{provider: string; model: string; mode: 'fast' | 'verified'; user_choice_allowed: boolean}>,
  ) =>
    save.mutate(
      {
        provider: read.default.provider,
        model: read.default.model,
        mode: read.default.mode,
        user_choice_allowed: read.default.user_choice_allowed,
        ...patch,
      },
      {
        onSuccess: () => toast.success(t('llmConnections', 'defaultSaveSuccess')),
        onError: () => toast.error(t('llmConnections', 'defaultSaveError')),
      },
    );
  const current = `${read.default.provider}:${read.default.model}`;
  return (
    <>
      <SettingsRow
        label={t('llmConnections', 'defaultLabel')}
        htmlFor={isManager ? 'engine-default' : undefined}
        hint={t('llmConnections', 'cardDescription')}
      >
        {({describedBy}) =>
          isManager ? (
            <Select
              value={current}
              onValueChange={(v) => {
                const [provider, model] = v.split(':');
                write({provider, model});
              }}
            >
              <SelectTrigger id="engine-default" variant="quiet" aria-describedby={describedBy}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {read.catalog.map((e) => (
                  <SelectItem key={e.canonical} value={e.canonical}>
                    {e.label}{' '}
                    <span className="text-[12px] text-muted-foreground">
                      ({providers.find((p) => p.id === e.provider)?.label ?? e.provider})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-2 px-2 text-[13px]">
              {label(read.default.provider, read.default.model)}
              {!read.default.user_choice_allowed && (
                <Badge variant="secondary">{t('llmConnections', 'lockedBadge')}</Badge>
              )}
            </div>
          )
        }
      </SettingsRow>
      <SettingsRow label={t('llmConnections', 'modeLabel')} htmlFor={isManager ? 'engine-mode' : undefined}>
        {isManager ? (
          <Select value={read.default.mode} onValueChange={(v) => write({mode: v as 'fast' | 'verified'})}>
            <SelectTrigger id="engine-mode" variant="quiet" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fast">{t('llmConnections', 'modeFast')}</SelectItem>
              <SelectItem value="verified">{t('llmConnections', 'modeVerified')}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span className="px-2 text-[13px]">
            {read.default.mode === 'verified' ? t('llmConnections', 'modeVerified') : t('llmConnections', 'modeFast')}
          </span>
        )}
      </SettingsRow>
      {isManager && (
        <SettingsRow label={t('llmConnections', 'lockLabel')} htmlFor="engine-lock" hint={t('llmConnections', 'lockHint')}>
          {({describedBy}) => (
            <Switch
              id="engine-lock"
              checked={!read.default.user_choice_allowed}
              disabled={save.isPending}
              onCheckedChange={(checked) => write({user_choice_allowed: !checked})}
              aria-describedby={describedBy}
            />
          )}
        </SettingsRow>
      )}
    </>
  );
}

function SharedKeys({projectId, providers}: {projectId: string; providers: ProviderRead[]}) {
  const connections = useProjectConnections(projectId);
  const create = useCreateProjectConnection(projectId);
  const remove = useDeleteProjectConnection(projectId);
  const options = providers.filter((p) => p.scopes.includes('project'));
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState(options[0]?.id ?? 'openai');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const submit = () =>
    create.mutate(
      {provider, label, api_key: apiKey, base_url: null, allowed_models: []},
      {
        onSuccess: () => {
          toast.success(t('llmConnections', 'sharedCreateSuccess'));
          setAdding(false);
          setLabel('');
          setApiKey('');
        },
        onError: () => toast.error(t('llmConnections', 'sharedCreateError')),
      },
    );
  const addButton = (
    <Button size="sm" variant="ghost" onClick={() => setAdding(true)} disabled={adding}>
      <Plus strokeWidth={1.5} />
      {t('llmConnections', 'sharedAddButton')}
    </Button>
  );
  return (
    <>
      {connections.isPending && (
        <>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </>
      )}
      {connections.isError && (
        <p className="flex items-center gap-2 text-[13px] text-destructive">
          {t('llmConnections', 'sharedLoadError')}
          <Button size="sm" variant="ghost" onClick={() => void connections.refetch()}>
            {t('llmConnections', 'retry')}
          </Button>
        </p>
      )}
      {connections.data && connections.data.length === 0 && !adding && (
        <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
          <span>{t('llmConnections', 'sharedEmpty')}</span>
          {addButton}
        </div>
      )}
      {connections.data && connections.data.length > 0 && (
        <ul role="list" aria-label={t('llmConnections', 'sharedTitle')}>
          {connections.data.map((row) => {
            const spec = providers.find((p) => p.id === row.provider);
            return (
              <li key={row.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-muted/60">
                <span className="truncate font-medium">{row.label}</span>
                <span className="text-muted-foreground">{spec?.label ?? row.provider}</span>
                <Badge variant="outline">{t('llmConnections', SERVES_COPY[servesOf(spec)])}</Badge>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <IconButton
                      label={t('llmConnections', 'sharedRemoveAria')}
                      className="ml-auto"
                      icon={<Trash2 strokeWidth={1.5} />}
                    />
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('llmConnections', 'sharedRemoveTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>{t('llmConnections', 'sharedRemoveDescription')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('llmConnections', 'cancelButton')}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          remove.mutate(row.id, {
                            onSuccess: () => toast.success(t('llmConnections', 'sharedRemoveSuccess')),
                            onError: () => toast.error(t('llmConnections', 'sharedRemoveError')),
                          })
                        }
                      >
                        {t('llmConnections', 'removeConfirm')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            );
          })}
        </ul>
      )}
      {adding ? (
        <form
          className="space-y-1"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <SettingsRow label={t('llmConnections', 'providerLabel')} htmlFor="shared-provider">
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger id="shared-provider" variant="quiet">
                <SelectValue placeholder={t('llmConnections', 'providerPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {options.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}{' '}
                    <span className="text-[12px] text-muted-foreground">
                      ({t('llmConnections', SERVES_COPY[servesOf(p)])})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow label={t('llmConnections', 'labelLabel')} htmlFor="shared-label">
            <Input
              id="shared-label"
              variant="quiet"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('llmConnections', 'labelPlaceholder')}
              maxLength={80}
            />
          </SettingsRow>
          <SettingsRow label={t('llmConnections', 'keyLabel')} htmlFor="shared-key">
            <Input
              id="shared-key"
              variant="quiet"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('llmConnections', 'keyPlaceholder')}
            />
          </SettingsRow>
          <SettingsActions>
            <Button type="submit" size="sm" disabled={create.isPending || label === '' || apiKey === ''}>
              {create.isPending ? t('llmConnections', 'saving') : t('llmConnections', 'saveButton')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              {t('llmConnections', 'cancelButton')}
            </Button>
          </SettingsActions>
        </form>
      ) : (connections.data?.length ?? 0) > 0 || connections.isError ? (
        addButton
      ) : null}
    </>
  );
}

export function AiEngineSection({projectId}: {projectId: string}) {
  const {isManager} = useProjectMemberRole(projectId);
  const engine = useLlmEngine(projectId);
  const providers = useProviders();
  const providerRows = providers.data ?? [];
  return (
    <SettingsPage>
      <SettingsGroup>
        {engine.isPending && (
          <>
            <Skeleton className="h-8 w-full" data-testid="ai-engine-skeleton" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </>
        )}
        {engine.isError && (
          <p className="flex items-center gap-2 text-[13px] text-destructive">
            {t('llmConnections', 'cardLoadError')}
            <Button size="sm" variant="ghost" onClick={() => void engine.refetch()}>
              {t('llmConnections', 'retry')}
            </Button>
          </p>
        )}
        {engine.data && (
          <EngineCard projectId={projectId} read={engine.data} isManager={isManager} providers={providerRows} />
        )}
      </SettingsGroup>
      {isManager && (
        <SettingsGroup title={t('llmConnections', 'sharedTitle')} hint={t('llmConnections', 'sharedDescription')}>
          <SharedKeys projectId={projectId} providers={providerRows} />
        </SettingsGroup>
      )}
    </SettingsPage>
  );
}
