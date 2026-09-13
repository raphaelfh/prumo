/**
 * Project → Settings → review tab → AI engine card (spec §5); Task 27 adds
 * the Shared keys card beside it. The card writes the project DEFAULT (a
 * catalogue pair), its mode and the lock. Each card's read loads and fails
 * independently of the other's.
 */
import {toast} from 'sonner';

import {SettingsCard} from '@/components/settings';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Skeleton} from '@/components/ui/skeleton';
import {Switch} from '@/components/ui/switch';
import {useLlmEngine, useSetLlmEngine} from '@/hooks/extraction/useLlmEngine';
import {useProviders} from '@/hooks/user/useLlmConnections';
import {useProjectMemberRole} from '@/hooks/useProjectMemberRole';
import {t} from '@/lib/copy';
import type {ProviderRead} from '@/services/llmConnectionsService';
import type {LlmEngineRead} from '@/services/llmEngineService';

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

export function AiEngineSection({projectId}: {projectId: string}) {
  const {isManager} = useProjectMemberRole(projectId);
  const engine = useLlmEngine(projectId);
  const providers = useProviders();
  const providerRows = providers.data ?? [];
  return (
    <>
      {/* Task 27 adds the Shared keys card as the second child of this fragment. */}
      <SettingsCard title={t('llmConnections', 'cardTitle')} description={t('llmConnections', 'cardDescription')}>
        {engine.isPending && <Skeleton className="h-20 w-full" />}
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
    </>
  );
}
