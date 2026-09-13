/**
 * Worklist gear → "Your engine for new runs" (spec §5). Writes the VIEWER's
 * own row (`PUT /llm-engine/me`); the project default lives in Project
 * Settings. Rows are grouped by provider from the catalogue; each row carries
 * a scope tag from `availability` — a row with none is not selectable and
 * links to Integrations, so a pick can never lead to a guaranteed 409 at
 * kickoff. The lock binds members, not managers; it is enforced server-side,
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
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {useLlmEngine, useSetMyEngine} from '@/hooks/extraction/useLlmEngine';
import {useProjectMemberRole} from '@/hooks/useProjectMemberRole';
import {useProviders} from '@/hooks/user/useLlmConnections';
import {t} from '@/lib/copy';
import type {LlmEngineCatalogEntry, LlmEngineRead} from '@/services/llmEngineService';

const INTEGRATIONS_ROUTE = '/settings?tab=integrations';

type Availability = LlmEngineRead['availability'][string];
const TAG_COPY: Record<NonNullable<Availability>, 'tagYourKey' | 'tagProjectKey' | 'tagPrumo'> = {
    user: 'tagYourKey',
    project: 'tagProjectKey',
    global: 'tagPrumo',
};

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
    const {isManager} = useProjectMemberRole(projectId);
    const providers = useProviders();
    const read = engine.data;
    const locked = Boolean(read && !read.default.user_choice_allowed && !isManager);
    const providerLabel = (id: string) => providers.data?.find((p) => p.id === id)?.label ?? id;
    const tooltip =
        engine.isPending || !read
            ? t('llmConnections', 'gearLoading')
            : t('llmConnections', 'gearTooltip').replace('{{engine}}', engineLabel(read));

    const pick = (body: {provider: string; model: string; connection_id: string | null}) => {
        if (!read) return;
        setMine.mutate(
            {...body, mode: read.effective.mode},
            {
                onSuccess: () => toast.success(t('llmConnections', 'pickSuccess')),
                onError: () => toast.error(t('llmConnections', 'pickError')),
            },
        );
    };
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
                            </CommandList>
                            {Object.values(read.availability).some((a) => a === null) && (
                                <div className="border-t border-border/40 px-3 py-2 text-[12px]">
                                    <Link to={INTEGRATIONS_ROUTE} className="text-primary hover:underline">
                                        {t('llmConnections', 'needsKeyLink')}
                                    </Link>
                                </div>
                            )}
                        </Command>
                    )}
                </PopoverContent>
            </Popover>
        </TooltipProvider>
    );
}
