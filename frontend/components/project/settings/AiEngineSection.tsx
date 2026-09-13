/**
 * Project → Settings → review tab → AI engine card (spec §5) + Shared keys —
 * the project's hosted-provider keys, every provider with "project" in its
 * scopes, llama_cloud included, each tagged by what it serves. The engine card
 * writes the project DEFAULT (a catalogue pair), its mode and the lock. Each
 * card's read loads and fails independently of the other's.
 */
import {Plus, Trash2} from 'lucide-react';
import {useState} from 'react';
import {toast} from 'sonner';

import {SettingsCard} from '@/components/settings';
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
import {Label} from '@/components/ui/label';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Skeleton} from '@/components/ui/skeleton';
import {Switch} from '@/components/ui/switch';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
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
    <div className="space-y-3 text-[13px]">
      <div className="space-y-1.5">
        <Label htmlFor="engine-default" className="font-medium">
          {t('llmConnections', 'defaultLabel')}
        </Label>
        {isManager ? (
          <Select
            value={current}
            onValueChange={(v) => {
              const [provider, model] = v.split(':');
              write({provider, model});
            }}
          >
            <SelectTrigger id="engine-default" className="h-9 text-[13px]">
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
          <p id="engine-default">
            {label(read.default.provider, read.default.model)}
            {!read.default.user_choice_allowed && (
              <Badge className="ml-2" variant="secondary">
                {t('llmConnections', 'lockedBadge')}
              </Badge>
            )}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="font-medium">{t('llmConnections', 'modeLabel')}</span>
        {isManager ? (
          <Select value={read.default.mode} onValueChange={(v) => write({mode: v as 'fast' | 'verified'})}>
            <SelectTrigger className="h-8 w-32 text-[13px]" aria-label={t('llmConnections', 'modeLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fast">{t('llmConnections', 'modeFast')}</SelectItem>
              <SelectItem value="verified">{t('llmConnections', 'modeVerified')}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span>
            {read.default.mode === 'verified' ? t('llmConnections', 'modeVerified') : t('llmConnections', 'modeFast')}
          </span>
        )}
      </div>
      {isManager && (
        <div className="flex items-center gap-3">
          <Switch
            id="engine-lock"
            checked={!read.default.user_choice_allowed}
            disabled={save.isPending}
            onCheckedChange={(checked) => write({user_choice_allowed: !checked})}
            aria-label={t('llmConnections', 'lockLabel')}
          />
          <Label htmlFor="engine-lock">{t('llmConnections', 'lockLabel')}</Label>
          <span className="text-[12px] text-muted-foreground">{t('llmConnections', 'lockHint')}</span>
        </div>
      )}
    </div>
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
    <Button size="sm" variant="outline" onClick={() => setAdding(true)} disabled={adding}>
      <Plus className="mr-1 h-4 w-4" strokeWidth={1.5} />
      {t('llmConnections', 'sharedAddButton')}
    </Button>
  );
  return (
    <div className="space-y-3">
      {connections.isPending && (
        <div className="space-y-1">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
        </div>
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('llmConnections', 'labelLabel')}</TableHead>
              <TableHead>{t('llmConnections', 'providerLabel')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {connections.data.map((row) => {
              const spec = providers.find((p) => p.id === row.provider);
              return (
                <TableRow key={row.id}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell>
                    {spec?.label ?? row.provider}{' '}
                    <Badge variant="outline">{t('llmConnections', SERVES_COPY[servesOf(spec)])}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <IconButton
                          label={t('llmConnections', 'sharedRemoveAria')}
                          icon={<Trash2 strokeWidth={1.5} />}
                        />
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('llmConnections', 'sharedRemoveTitle')}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('llmConnections', 'sharedRemoveDescription')}
                          </AlertDialogDescription>
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
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {adding ? (
        <form
          className="space-y-3 rounded-md border border-border/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="shared-provider" className="text-[13px] font-medium">
              {t('llmConnections', 'providerLabel')}
            </Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger id="shared-provider" className="h-9 text-[13px]">
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
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shared-label" className="text-[13px] font-medium">
              {t('llmConnections', 'labelLabel')}
            </Label>
            <Input
              id="shared-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('llmConnections', 'labelPlaceholder')}
              className="h-9 text-[13px]"
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shared-key" className="text-[13px] font-medium">
              {t('llmConnections', 'keyLabel')}
            </Label>
            <Input
              id="shared-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('llmConnections', 'keyPlaceholder')}
              className="h-9 text-[13px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={create.isPending || label === '' || apiKey === ''}>
              {create.isPending ? t('llmConnections', 'saving') : t('llmConnections', 'saveButton')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              {t('llmConnections', 'cancelButton')}
            </Button>
          </div>
        </form>
      ) : (connections.data?.length ?? 0) > 0 || connections.isError ? (
        addButton
      ) : null}
    </div>
  );
}

export function AiEngineSection({projectId}: {projectId: string}) {
  const {isManager} = useProjectMemberRole(projectId);
  const engine = useLlmEngine(projectId);
  const providers = useProviders();
  const providerRows = providers.data ?? [];
  return (
    <>
      <SettingsCard title={t('llmConnections', 'cardTitle')} description={t('llmConnections', 'cardDescription')}>
        {engine.isPending && <Skeleton className="h-20 w-full" data-testid="ai-engine-skeleton" />}
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
      </SettingsCard>
      {isManager && (
        <SettingsCard
          title={t('llmConnections', 'sharedTitle')}
          description={t('llmConnections', 'sharedDescription')}
        >
          <SharedKeys projectId={projectId} providers={providerRows} />
        </SettingsCard>
      )}
    </>
  );
}
