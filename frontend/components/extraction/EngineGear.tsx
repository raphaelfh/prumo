/**
 * Worklist gear → "Your engine for new runs" (spec §5). Writes the VIEWER's
 * own row (`PUT /llm-engine/me`); the project default lives in Project
 * Settings. Rows are grouped by provider from the catalogue; each row carries
 * a scope tag from `availability` — a row with none is not selectable and
 * links to Integrations, so a pick can never lead to a guaranteed 409 at
 * kickoff, plus one group per host the viewer owns. The lock binds members, not managers; it is enforced server-side,
 * this surface only mirrors it. One row per (user, project): the extraction
 * and QA worklists edit the same choice.
 */
import {Cpu} from 'lucide-react';
import {useState} from 'react';
import {Link} from 'react-router';
import {toast} from 'sonner';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {Skeleton} from '@/components/ui/skeleton';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {useClearMyEngine, useLlmEngine, useSetMyEngine} from '@/hooks/extraction/useLlmEngine';
import {useProjectMemberRole} from '@/hooks/useProjectMemberRole';
import {useMyConnections, useProviders} from '@/hooks/user/useLlmConnections';
import {t} from '@/lib/copy';
import type {LlmEngineCatalogEntry, LlmEngineRead} from '@/services/llmEngineService';

const INTEGRATIONS_ROUTE = '/settings?tab=integrations';

type Availability = LlmEngineRead['availability'][string];
const TAG_COPY: Record<NonNullable<Availability>, 'tagYourKey' | 'tagProjectKey' | 'tagPrumo'> = {
    user: 'tagYourKey',
    project: 'tagProjectKey',
    global: 'tagPrumo',
};

/**
 * A failed write is reported by its server error code (spec §6): the lock
 * and the missing-key case get their own copy, everything else the generic
 * line. The code is read structurally off the error (`ApiError.code` from the
 * envelope) — importing the client here would drag it into every test.
 */
const ERROR_COPY: Record<string, 'lockedReason' | 'pickErrorNeedsKey'> = {
    LLM_ENGINE_LOCKED: 'lockedReason',
    LLM_ENGINE_NEEDS_KEY: 'pickErrorNeedsKey',
};

function writeFailed(error: unknown): void {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
    toast.error(t('llmConnections', (code && ERROR_COPY[code]) || 'pickError'));
}

function engineLabel(read: LlmEngineRead): string {
    const {effective} = read;
    const entry = read.catalog.find((e) => e.provider === effective.provider && e.model === effective.model);
    if (entry) return entry.label;
    return effective.connection_label
        ? `${effective.connection_label} · ${effective.model}`
        : `${effective.provider}:${effective.model}`;
}

function defaultLabel(read: LlmEngineRead): string {
    const entry = read.catalog.find(
        (e) => e.provider === read.default.provider && e.model === read.default.model,
    );
    return entry?.label ?? `${read.default.provider}:${read.default.model}`;
}

function groupByProvider(
    catalog: LlmEngineCatalogEntry[],
): Array<{provider: string; entries: LlmEngineCatalogEntry[]}> {
    const groups: Array<{provider: string; entries: LlmEngineCatalogEntry[]}> = [];
    for (const entry of catalog) {
        const group = groups.find((g) => g.provider === entry.provider);
        if (group) group.entries.push(entry);
        else groups.push({provider: entry.provider, entries: [entry]});
    }
    return groups;
}

export function EngineGear({projectId}: {projectId: string}) {
    const [open, setOpen] = useState(false);
    const engine = useLlmEngine(projectId);
    const setMine = useSetMyEngine(projectId);
    const clearMine = useClearMyEngine(projectId);
    const {isManager} = useProjectMemberRole(projectId);
    const providers = useProviders();
    const mine = useMyConnections();
    const read = engine.data;
    const locked = Boolean(read && !read.default.user_choice_allowed && !isManager);
    const providerLabel = (id: string) => providers.data?.find((p) => p.id === id)?.label ?? id;
    const hosts = (mine.data ?? []).filter((c) => c.base_url !== null && c.validation_status === 'ok');
    // Only a CATALOGUE row can be "needs a key": `openai_compatible` has no
    // catalogue entries — its availability tracks the viewer's own hosts,
    // which the noHostsLink covers instead.
    const needsKey = Boolean(read?.catalog.some((e) => (read.availability[e.provider] ?? null) === null));
    const tooltip =
        engine.isPending || !read
            ? t('llmConnections', 'gearLoading')
            : t('llmConnections', 'gearTooltip').replace('{{engine}}', engineLabel(read));

    const pick = (body: {provider: string; model: string; connection_id: string | null}) => {
        if (!read) return;
        setMine.mutate(
            {...body, mode: read.effective.mode},
            {
                onSuccess: () => {
                    setOpen(false);
                    toast.success(t('llmConnections', 'pickSuccess'));
                },
                onError: writeFailed,
            },
        );
    };
    const setMode = (mode: string) => {
        if (!read || (mode !== 'fast' && mode !== 'verified')) return;
        setMine.mutate(
            {
                provider: read.effective.provider,
                model: read.effective.model,
                mode,
                connection_id: read.effective.connection_id ?? null,
            },
            {onError: writeFailed},
        );
    };
    const followDefault = () =>
        clearMine.mutate(undefined, {
            onSuccess: () => setOpen(false),
            onError: writeFailed,
        });
    const isCurrent = (provider: string, model: string, connectionId: string | null) =>
        Boolean(
            read &&
                read.effective.provider === provider &&
                read.effective.model === model &&
                (read.effective.connection_id ?? null) === connectionId,
        );

    return (
        <TooltipProvider>
            <Popover open={open} onOpenChange={setOpen}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="p-0 rounded-md text-muted-foreground transition-colors hover:bg-muted/50"
                                aria-label={t('llmConnections', 'gearAria')}
                                data-testid="engine-gear"
                            >
                                <Cpu className="h-4 w-4" strokeWidth={1.5} />
                            </Button>
                        </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent>{tooltip}</TooltipContent>
                </Tooltip>
                <PopoverContent align="end" className="w-80 p-0">
                    {engine.isPending && (
                        <div className="space-y-2 p-3" aria-busy="true">
                            <Skeleton className="h-6 w-full" />
                            <Skeleton className="h-6 w-full" />
                        </div>
                    )}
                    {engine.isError && (
                        <p className="flex items-center gap-2 p-3 text-[13px] text-destructive">
                            {t('llmConnections', 'pickerLoadError')}
                            <Button size="sm" variant="ghost" onClick={() => void engine.refetch()}>
                                {t('llmConnections', 'retry')}
                            </Button>
                        </p>
                    )}
                    {read && (
                        <Command>
                            <div className="space-y-1 border-b border-border/40 px-3 py-2 text-[12px] text-muted-foreground">
                                <p>
                                    {t('llmConnections', 'projectDefaultLine').replace(
                                        '{{engine}}',
                                        defaultLabel(read),
                                    )}
                                </p>
                                {locked && <p>{t('llmConnections', 'lockedReason')}</p>}
                                {read.effective.retired && (
                                    <p className="text-destructive">{t('llmConnections', 'retiredNote')}</p>
                                )}
                                <div className="flex items-center gap-2">
                                    <span>{t('llmConnections', 'modeLabel')}</span>
                                    <ToggleGroup
                                        type="single"
                                        value={read.effective.mode}
                                        onValueChange={setMode}
                                        disabled={locked}
                                        aria-label={t('llmConnections', 'modeLabel')}
                                    >
                                        <ToggleGroupItem value="fast">
                                            {t('llmConnections', 'modeFast')}
                                        </ToggleGroupItem>
                                        <ToggleGroupItem value="verified">
                                            {t('llmConnections', 'modeVerified')}
                                        </ToggleGroupItem>
                                    </ToggleGroup>
                                </div>
                            </div>
                            <CommandInput placeholder={t('llmConnections', 'gearAria')} />
                            <CommandList>
                                <CommandEmpty>{t('llmConnections', 'pickerNoMatch')}</CommandEmpty>
                                {groupByProvider(read.catalog).map((group) => (
                                    <CommandGroup key={group.provider} heading={providerLabel(group.provider)}>
                                        {group.entries.map((entry) => {
                                            const availability = read.availability[entry.provider] ?? null;
                                            const selectable = availability !== null && !locked;
                                            return (
                                                <CommandItem
                                                    key={entry.canonical}
                                                    value={`${entry.label} ${entry.canonical}`}
                                                    disabled={!selectable}
                                                    aria-disabled={!selectable}
                                                    data-current={isCurrent(entry.provider, entry.model, null)}
                                                    onSelect={() =>
                                                        pick({
                                                            provider: entry.provider,
                                                            model: entry.model,
                                                            connection_id: null,
                                                        })
                                                    }
                                                >
                                                    <span className="flex-1">{entry.label}</span>
                                                    {availability ? (
                                                        <Badge variant="outline">
                                                            {t('llmConnections', TAG_COPY[availability])}
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="secondary">
                                                            {t('llmConnections', 'tagNeedsKey')}
                                                        </Badge>
                                                    )}
                                                </CommandItem>
                                            );
                                        })}
                                    </CommandGroup>
                                ))}
                                {hosts.map((host) => (
                                    <CommandGroup key={host.id} heading={host.label}>
                                        {host.allowed_models.map((model) => (
                                            <CommandItem
                                                key={`${host.id}:${model}`}
                                                value={`${host.label} ${model}`}
                                                disabled={locked}
                                                aria-disabled={locked}
                                                data-current={isCurrent('openai_compatible', model, host.id)}
                                                onSelect={() =>
                                                    pick({
                                                        provider: 'openai_compatible',
                                                        model,
                                                        connection_id: host.id,
                                                    })
                                                }
                                            >
                                                <span className="flex-1">{model}</span>
                                                <Badge variant="outline">
                                                    {t('llmConnections', 'tagYourKey')}
                                                </Badge>
                                            </CommandItem>
                                        ))}
                                        <p className="px-2 py-1 text-[11px] text-muted-foreground">
                                            {t('llmConnections', 'hostGroupNote')}
                                        </p>
                                    </CommandGroup>
                                ))}
                            </CommandList>
                            <div className="flex items-center justify-between gap-2 border-t border-border/40 px-3 py-2 text-[12px]">
                                {needsKey ? (
                                    <Link to={INTEGRATIONS_ROUTE} className="text-primary hover:underline">
                                        {t('llmConnections', 'needsKeyLink')}
                                    </Link>
                                ) : hosts.length === 0 ? (
                                    <Link to={INTEGRATIONS_ROUTE} className="text-primary hover:underline">
                                        {t('llmConnections', 'noHostsLink')}
                                    </Link>
                                ) : (
                                    <span />
                                )}
                                {read.source === 'user' && !locked && (
                                    <Button size="sm" variant="ghost" onClick={followDefault}>
                                        {t('llmConnections', 'followDefault')}
                                    </Button>
                                )}
                            </div>
                        </Command>
                    )}
                </PopoverContent>
            </Popover>
        </TooltipProvider>
    );
}
